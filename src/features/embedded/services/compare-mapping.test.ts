// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@/types/timeline'
import { originalOf, sourceSecondsAt, timelineFrameAt } from './compare-mapping'

const FPS = 30

// The take cut in two: 0–2 s of the file, then 4–6 s (2–4 s were removed).
const ITEMS = [
  {
    id: 'b',
    type: 'video',
    mediaId: 'take',
    from: 60,
    durationInFrames: 60,
    sourceStart: 120,
    sourceFps: 30,
  },
  { id: 'music', type: 'audio', mediaId: 'bed', from: 0, durationInFrames: 120 },
  {
    id: 'a',
    type: 'video',
    mediaId: 'take',
    from: 0,
    durationInFrames: 60,
    sourceStart: 0,
    sourceFps: 30,
  },
  {
    id: 'broll',
    type: 'video',
    mediaId: 'city',
    from: 20,
    durationInFrames: 30,
    sourceStart: 0,
    sourceFps: 30,
  },
] as unknown as TimelineItem[]

const original = originalOf(ITEMS, FPS)!

describe('the original of an edit', () => {
  it('is the media of the first video clip, with each of its clips in timeline order', () => {
    expect(original).toEqual({
      mediaId: 'take',
      pieces: [
        { from: 0, durationInFrames: 60, start: 0, speed: 1 },
        { from: 60, durationInFrames: 60, start: 4, speed: 1 },
      ],
    })
    expect(originalOf([], FPS)).toBeNull()
  })

  it('maps a timeline frame to the second of the file it shows', () => {
    expect(sourceSecondsAt(30, original.pieces, FPS)).toBe(1)
    expect(sourceSecondsAt(75, original.pieces, FPS)).toBe(4.5)
    expect(sourceSecondsAt(500, original.pieces, FPS)).toBe(6)
  })

  it('maps a second of the file to the frame that shows it, or to where the edit picks it up again', () => {
    expect(timelineFrameAt(1, original.pieces, FPS)).toEqual({ frame: 30, kept: true })
    expect(timelineFrameAt(2.5, original.pieces, FPS)).toEqual({ frame: 60, kept: false })
    expect(timelineFrameAt(4.5, original.pieces, FPS)).toEqual({ frame: 75, kept: true })
    expect(timelineFrameAt(9, original.pieces, FPS)).toEqual({ frame: 119, kept: false })
  })
})
