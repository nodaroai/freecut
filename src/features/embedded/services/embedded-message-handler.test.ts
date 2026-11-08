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
    'https://next.tools.nodaro.ai',
    'https://launch-staging.nodaro.ai',
    'http://localhost:5173',
    'http://localhost:3000',
  ])('accepts %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true)
  })

  it.each([
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

describe('EMBED_PARENT_SOURCES', () => {
  it('is exactly nodaro.ai, its https subdomains and localhost', () => {
    expect(EMBED_PARENT_SOURCES).toEqual([
      "'self'",
      'https://nodaro.ai',
      'https://*.nodaro.ai',
      'http://localhost:*',
    ])
  })

  it('is what the Caddyfile sends as frame-ancestors, so framing and messages cannot drift apart', () => {
    const caddyfile = readFileSync('Caddyfile', 'utf8')
    const policies = [...caddyfile.matchAll(/Content-Security-Policy\s+"([^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(policies).toEqual([`frame-ancestors ${EMBED_PARENT_SOURCES.join(' ')}`])
  })

  it('lets every listed parent send messages, not only frame the editor', () => {
    // One origin per source; 'self' is the editor itself, which sends no commands.
    const sampleOf = (source: string) =>
      source.replace('://*.', '://studio.').replace(/:\*$/, ':5173')
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
