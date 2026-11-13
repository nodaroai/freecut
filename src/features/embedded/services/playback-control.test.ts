import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  frame: 0,
  playing: false,
  scrolledTo: [] as number[],
}))
vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => ({
      setCurrentFrame: (frame: number) => {
        state.frame = frame
      },
      play: () => {
        state.playing = true
      },
      pause: () => {
        state.playing = false
      },
    }),
  },
}))
vi.mock('../deps/timeline-contract', () => ({
  useTimelineViewportStore: {
    getState: () => ({ requestScrollToFrame: (frame: number) => state.scrolledTo.push(frame) }),
  },
}))

import { handlePlayback } from './playback-control'

const message = (payload: unknown) =>
  ({ data: { type: 'NODARO_PLAYBACK', payload } }) as MessageEvent

beforeEach(() => {
  state.frame = 0
  state.playing = false
  state.scrolledTo = []
})

describe('NODARO_PLAYBACK', () => {
  it('moves the playhead to the frame and brings it into view on the timeline', () => {
    handlePlayback(message({ action: 'seek', frame: 412.6 }))
    expect(state.frame).toBe(413)
    expect(state.scrolledTo).toEqual([413])
  })

  it('plays and pauses without moving the view', () => {
    handlePlayback(message({ action: 'play' }))
    expect(state.playing).toBe(true)
    handlePlayback(message({ action: 'pause' }))
    expect(state.playing).toBe(false)
    expect(state.scrolledTo).toEqual([])
  })

  it('ignores a frame that is not a number', () => {
    handlePlayback(message({ action: 'seek', frame: 'later' }))
    expect(state.scrolledTo).toEqual([])
    expect(state.frame).toBe(0)
  })
})
