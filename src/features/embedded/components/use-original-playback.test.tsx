import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackStore } from '@/shared/state/playback'
import type { OriginalPiece } from '../services/compare-mapping'
import type { CompareMode } from '../stores/compare-store'
import { useOriginalPlayback } from './use-original-playback'

const FPS = 30
// 0–2 s of the file, then 4–6 s: the edit removed 2–4 s.
const PIECES: OriginalPiece[] = [
  { from: 0, durationInFrames: 60, start: 0, speed: 1 },
  { from: 60, durationInFrames: 60, start: 4, speed: 1 },
]

function fakeVideo() {
  const video = {
    currentTime: 0,
    paused: true,
    seeking: false,
    playbackRate: 1,
    muted: false,
    volume: 1,
    play: vi.fn(() => {
      video.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      video.paused = true
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  return video
}

// Animation frames run when the test says so.
let frames: FrameRequestCallback[] = []
const runFrame = (now: number) => {
  const due = frames
  frames = []
  for (const callback of due) callback(now)
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  usePlaybackStore.getState().pause()
  usePlaybackStore.getState().setPreviewFrame(null)
  usePlaybackStore.getState().setCurrentFrame(30)
})
afterEach(() => vi.unstubAllGlobals())

const mount = (video: ReturnType<typeof fakeVideo>, mode: CompareMode) =>
  renderHook(
    (props: { mode: CompareMode }) =>
      useOriginalPlayback({
        video: video as unknown as HTMLVideoElement,
        mode: props.mode,
        pieces: PIECES,
        fps: FPS,
      }),
    { initialProps: { mode } },
  )

describe('the original alone', () => {
  it('plays from the transport, the cut parts included, while the edit holds still', () => {
    const video = fakeVideo()
    const hook = mount(video, 'source')
    expect(video.currentTime).toBe(1)

    usePlaybackStore.getState().play()
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(video.play).toHaveBeenCalledTimes(1)

    // Playing what the edit removed, the playhead waits where the edit resumes...
    video.currentTime = 2.5
    runFrame(200)
    expect(usePlaybackStore.getState().currentFrame).toBe(60)
    // ...and moves on with the original once the edit has it again.
    video.currentTime = 4.5
    runFrame(400)
    expect(usePlaybackStore.getState().currentFrame).toBe(75)

    usePlaybackStore.getState().togglePlayPause()
    expect(video.pause).toHaveBeenCalled()
    expect(video.paused).toBe(true)

    // Back to the edit at the moment the original showed.
    video.currentTime = 5
    hook.rerender({ mode: 'program' })
    expect(usePlaybackStore.getState().currentFrame).toBe(90)
  })

  it('seeks the original when the playhead is moved', () => {
    const video = fakeVideo()
    mount(video, 'source')

    usePlaybackStore.getState().setCurrentFrame(90)

    expect(video.currentTime).toBe(5)
  })
})

describe('the original beside the edit', () => {
  it('follows the playing edit, silent, and jumps at a cut', () => {
    const video = fakeVideo()
    mount(video, 'split')
    usePlaybackStore.getState().play()
    expect(usePlaybackStore.getState().isPlaying).toBe(true)

    runFrame(16)
    expect(video.muted).toBe(true)
    expect(video.play).toHaveBeenCalled()
    expect(video.currentTime).toBe(1)

    // The edit crossed the cut: the original jumps to the kept part.
    usePlaybackStore.getState().setCurrentFrame(66)
    runFrame(32)
    expect(video.currentTime).toBeCloseTo(4.2)
  })
})
