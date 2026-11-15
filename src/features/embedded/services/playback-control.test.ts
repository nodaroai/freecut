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
const opened = vi.hoisted(() => [] as unknown[])
vi.mock('./open-sequence', () => ({
  openSequence: (sequenceId: unknown) => opened.push(sequenceId),
}))

import { useCompareStore } from '../stores/compare-store'
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

  it('opens the timeline tab a parent names, and does nothing else', () => {
    handlePlayback(message({ action: 'open-sequence', sequenceId: 'main', frame: 40 }))
    expect(opened).toEqual(['main'])
    expect(state.frame).toBe(0)
  })

  it('shows the original beside the edit when asked, and ignores a mode it does not know', () => {
    handlePlayback(message({ action: 'compare', mode: 'split', split: 0.3 }))
    expect(useCompareStore.getState()).toMatchObject({ offered: true, mode: 'split', split: 0.3 })

    handlePlayback(message({ action: 'compare', mode: 'sideways' }))
    expect(useCompareStore.getState().mode).toBe('split')

    handlePlayback(message({ action: 'compare', mode: 'program' }))
    expect(useCompareStore.getState()).toMatchObject({ mode: 'program', split: 0.3 })
  })

  it('ignores a frame that is not a number', () => {
    handlePlayback(message({ action: 'seek', frame: 'later' }))
    expect(state.scrolledTo).toEqual([])
    expect(state.frame).toBe(0)
  })
})
