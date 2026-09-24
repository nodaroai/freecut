import { describe, it, expect } from 'vitest'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { chooseAudioPlacement } from './timeline-add'

const track = (
  id: string,
  name: string,
  order: number,
  extra: Partial<TimelineTrack> = {},
): TimelineTrack => ({
  id,
  name,
  kind: name.startsWith('A') ? 'audio' : 'video',
  order,
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  items: [],
  ...extra,
})

const item = (trackId: string, from: number, durationInFrames: number): TimelineItem =>
  ({
    id: `${trackId}-${from}`,
    trackId,
    from,
    durationInFrames,
    type: 'audio',
  }) as unknown as TimelineItem

const V1 = track('v1', 'V1', 0)
const A1 = track('a1', 'A1', 1)
const A2 = track('a2', 'A2', 2)

describe('chooseAudioPlacement — where "Add to timeline" puts a take', () => {
  it('the first audio track in the timeline order, at the playhead', () => {
    expect(
      chooseAudioPlacement({
        tracks: [A2, V1, A1],
        items: [],
        playheadFrame: 90,
        durationInFrames: 300,
      }),
    ).toEqual({ trackId: 'a1', trackName: 'A1', from: 90 })
  })

  it('skips a track with no room at the playhead for the next one that has it', () => {
    expect(
      chooseAudioPlacement({
        tracks: [V1, A1, A2],
        items: [item('a1', 0, 120)],
        playheadFrame: 30,
        durationInFrames: 300,
      }),
    ).toEqual({ trackId: 'a2', trackName: 'A2', from: 30 })
  })

  it('with no room at the playhead anywhere, the nearest room on the first audio track', () => {
    const placed = chooseAudioPlacement({
      tracks: [V1, A1],
      items: [item('a1', 0, 120)],
      playheadFrame: 60,
      durationInFrames: 30,
    })
    expect(placed).toEqual({ trackId: 'a1', trackName: 'A1', from: 120 })
  })

  it('never a locked track or a group — and nothing without an audio track', () => {
    expect(
      chooseAudioPlacement({
        tracks: [
          track('a0', 'A1', 1, { locked: true }),
          track('g', 'A9', 2, { isGroup: true }),
          A2,
        ],
        items: [],
        playheadFrame: 0,
        durationInFrames: 30,
      }),
    ).toEqual({ trackId: 'a2', trackName: 'A2', from: 0 })
    expect(
      chooseAudioPlacement({ tracks: [V1], items: [], playheadFrame: 0, durationInFrames: 30 }),
    ).toBeNull()
  })
})
