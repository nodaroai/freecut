import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  EMBED_PARENT_SOURCES,
  isAllowedOrigin,
  isEmptyBootPayload,
  resolvePrimaryVideoName,
} from './embedded-message-handler'

describe('isAllowedOrigin', () => {
  it.each([
    'https://nodaro.ai',
    'https://studio.nodaro.ai',
    'https://next.studio.nodaro.ai',
    'https://app.nodaro.ai',
    'https://next.nodaro.ai',
    'https://next.app.nodaro.ai',
    'https://tools.nodaro.ai',
    'https://next.tools.nodaro.ai',
    'https://flow.nodaro.ai',
    'https://next.flow.nodaro.ai',
    'https://launch-staging.nodaro.ai',
    'http://localhost:5173',
    'http://localhost:3000',
  ])('accepts %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true)
  })

  it.each([
    // The upload host, and hosts of the domain that the list does not name.
    'https://cdn.nodaro.ai',
    'https://unlisted.nodaro.ai',
    'https://x.studio.nodaro.ai',
    // Look-alikes of the domain.
    'https://nodaro.ai.evil.com',
    'https://next.studio.nodaro.ai.evil.example',
    'https://evilnodaro.ai',
    'https://evil-nodaro.ai',
    'https://x.evilnodaro.ai',
    // The right host on the wrong scheme or port.
    'http://nodaro.ai',
    'http://next.studio.nodaro.ai',
    'https://nodaro.ai:8443',
    'https://studio.nodaro.ai:8443',
    // Railway domains are not trusted, previews included.
    'https://x.up.railway.app',
    'https://studio-web-staging.up.railway.app',
    // Not an exact origin, the form MessageEvent.origin always has.
    'https://nodaro.ai/',
    'https://nodaro.ai/studio',
    'https://nodaro.ai:443',
    'https://NODARO.AI',
    'https://user@nodaro.ai',
    'https://nodaro.ai.',
    'https://.nodaro.ai',
    'null',
    '',
    // localhost stays as it was: plain http, with a port.
    'https://localhost:5173',
    'http://localhost',
    'http://127.0.0.1:5173',
    'https://evil.example.com',
  ])('refuses %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false)
  })
})

// The value of every Content-Security-Policy header the Caddyfile sends.
function framePolicies(): string[] {
  const caddyfile = readFileSync('Caddyfile', 'utf8')
  return [...caddyfile.matchAll(/Content-Security-Policy\s+"([^"]*)"/g)].map((m) => m[1] ?? '')
}

describe('EMBED_PARENT_SOURCES', () => {
  it('is exactly the app hosts that embed the editor, and localhost', () => {
    expect(EMBED_PARENT_SOURCES).toEqual([
      "'self'",
      'https://nodaro.ai',
      'https://app.nodaro.ai',
      'https://next.nodaro.ai',
      'https://studio.nodaro.ai',
      'https://next.studio.nodaro.ai',
      'https://tools.nodaro.ai',
      'https://next.tools.nodaro.ai',
      'https://flow.nodaro.ai',
      'https://next.flow.nodaro.ai',
      'https://next.app.nodaro.ai',
      'https://launch-staging.nodaro.ai',
      'http://localhost:*',
    ])
  })

  it('is what the Caddyfile sends as frame-ancestors, so framing and messages cannot drift apart', () => {
    expect(framePolicies()).toEqual([`frame-ancestors ${EMBED_PARENT_SOURCES.join(' ')}`])
  })

  it('never lets the upload host, cdn.nodaro.ai, frame the editor or send it commands', () => {
    expect(isAllowedOrigin('https://cdn.nodaro.ai')).toBe(false)
    // CSP cannot leave one host out of a wildcard, so the frame policy names each
    // parent's host exactly: no wildcard host, no bare scheme, never the upload host.
    const [policy = ''] = framePolicies()
    for (const source of policy.replace(/^frame-ancestors\s+/, '').split(/\s+/)) {
      if (source.startsWith("'")) continue // a keyword: 'self' is the editor's own origin
      const host = /^https?:\/\/([^:/]+)/.exec(source)?.[1]
      expect(host, source).toBeDefined()
      expect(host, source).not.toContain('*')
      expect(host, source).not.toBe('cdn.nodaro.ai')
    }
  })

  it('lets every listed parent send messages, not only frame the editor', () => {
    // One origin per source; 'self' is the editor itself, which sends no commands.
    // A wildcard source is sampled as a host no source names, so adding one fails
    // here too: the message check reads exact hosts only.
    const sampleOf = (source: string) =>
      source.replace('://*.', '://unlisted.').replace(/:\*$/, ':5173')
    for (const source of EMBED_PARENT_SOURCES.filter((s) => s !== "'self'")) {
      expect(isAllowedOrigin(sampleOf(source)), source).toBe(true)
    }
  })
})

describe('isEmptyBootPayload', () => {
  it('a NODARO_LOAD_VIDEO with no primary video is the empty-boot request; any primary defeats it', () => {
    expect(isEmptyBootPayload({})).toBe(true)
    expect(isEmptyBootPayload({ videoUrl: undefined, videoBuffer: undefined })).toBe(true)
    expect(isEmptyBootPayload({ videoUrl: 'https://cdn/x.mp4' })).toBe(false)
    expect(isEmptyBootPayload({ videoBuffer: new ArrayBuffer(1) })).toBe(false)
  })
})

describe('resolvePrimaryVideoName', () => {
  it('uses payload.videoName when present, legacy nodaro-edit.mp4 otherwise', () => {
    expect(resolvePrimaryVideoName('Shot 1.mp4')).toBe('Shot 1.mp4')
    expect(resolvePrimaryVideoName('  Shot 1.mp4  ')).toBe('Shot 1.mp4')
    expect(resolvePrimaryVideoName(undefined)).toBe('nodaro-edit.mp4')
    expect(resolvePrimaryVideoName('')).toBe('nodaro-edit.mp4')
    expect(resolvePrimaryVideoName('   ')).toBe('nodaro-edit.mp4')
    expect(resolvePrimaryVideoName(42)).toBe('nodaro-edit.mp4')
  })
})
