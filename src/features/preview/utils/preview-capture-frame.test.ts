import { describe, expect, it } from 'vitest'
import { resolvePreviewCaptureFrame } from './preview-capture-frame'

describe('resolvePreviewCaptureFrame', () => {
  it('uses previewFrame ahead of the live playback frame', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: 42,
        isPlaying: true,
        livePlaybackFrame: 80,
      }),
    ).toBe(42)
  })

  it('uses the live playback frame while playing', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: 24.6,
      }),
    ).toBe(25)
  })

  it('falls back to currentFrame while paused', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 10,
        previewFrame: null,
        isPlaying: false,
        livePlaybackFrame: 80,
      }),
    ).toBe(10)
  })

  it('falls back to a normalized currentFrame when live playback is unavailable', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 7.4,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: null,
      }),
    ).toBe(7)
  })

  it('ignores non-finite live playback frames', () => {
    expect(
      resolvePreviewCaptureFrame({
        currentFrame: 12,
        previewFrame: null,
        isPlaying: true,
        livePlaybackFrame: Number.NaN,
      }),
    ).toBe(12)
  })
})
