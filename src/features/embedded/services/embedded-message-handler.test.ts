import { describe, it, expect } from 'vitest'
import {
  isAllowedOrigin,
  isEmptyBootPayload,
  resolvePrimaryVideoName,
} from './embedded-message-handler'

describe('isAllowedOrigin', () => {
  it('allows studio.nodaro.ai, app/next, localhost and railway; rejects others', () => {
    expect(isAllowedOrigin('https://studio.nodaro.ai')).toBe(true)
    expect(isAllowedOrigin('https://app.nodaro.ai')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('https://foo.up.railway.app')).toBe(true)
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false)
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
