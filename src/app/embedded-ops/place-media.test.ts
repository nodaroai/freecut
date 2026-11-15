// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const MEDIA = vi.hoisted(
  () =>
    ({
      broll: {
        id: 'broll',
        fileName: 'city.mp4',
        mimeType: 'video/mp4',
        duration: 6,
        width: 1280,
        height: 720,
        fps: 30,
        audioCodec: 'aac',
      },
      still: {
        id: 'still',
        fileName: 'cover.png',
        mimeType: 'image/png',
        duration: 0,
        width: 1000,
        height: 1000,
        fps: 0,
      },
      music: {
        id: 'music',
        fileName: 'bed.mp3',
        mimeType: 'audio/mpeg',
        duration: 60,
        width: 0,
        height: 0,
        fps: 0,
      },
    }) as Record<string, Record<string, unknown>>,
)
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: {
    getMedia: vi.fn(async (id: string) => MEDIA[id] ?? null),
    getThumbnailBlobUrl: vi.fn(async () => null),
  },
}))
vi.mock('@/features/media-library/utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn(async (id: string) => `blob:${id}`),
}))

import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { embeddedEditOpEngine } from '../embedded-edit-ops'

type Op = Record<string, unknown> & { op: string }
type Placed = { id: string; trackId: string; from: number; durationInFrames: number }

async function batch(...ops: Op[]) {
  const prepared: Op[] = []
  for (const op of ops) prepared.push(await embeddedEditOpEngine.prepare(op))
  return useTimelineCommandStore
    .getState()
    .executeBatch({ type: 'APPLY_EDIT_OPS', payload: { count: ops.length } }, () =>
      prepared.map((op) => embeddedEditOpEngine.apply(op)),
    )
}

const track = (id: string, kind: 'video' | 'audio', order: number, extra = {}): TimelineTrack => ({
  id,
  name: id,
  kind,
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order,
  items: [],
  ...extra,
})

const TAKE = {
  id: 'take-1',
  type: 'video',
  trackId: 'v1',
  from: 0,
  durationInFrames: 300,
  label: 'take.mp4',
  src: 'blob:take',
  mediaId: 'take',
  sourceStart: 0,
  sourceEnd: 300,
  sourceDuration: 300,
  sourceFps: 30,
} as TimelineItem

const CAPTION = {
  id: 'cap-1',
  type: 'subtitle',
  trackId: 'captions',
  from: 0,
  durationInFrames: 300,
  label: 'Captions',
  cues: [],
  color: '#fff',
  source: { type: 'transcript', mediaId: 'take', clipId: 'take-1' },
} as unknown as TimelineItem

const items = () => useItemsStore.getState().items
const tracks = () => useItemsStore.getState().tracks
const trackOf = (id: string) => tracks().find((t) => t.id === id)!
const itemOf = (id: string) => useItemsStore.getState().itemById[id]!

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useItemsStore
    .getState()
    .setTracks([track('captions', 'video', -1), track('v1', 'video', 0), track('a1', 'audio', 1)])
  useItemsStore.getState().setItems([TAKE, CAPTION])
  useProjectStore.setState({
    currentProject: {
      id: 'p1',
      name: 'Take',
      metadata: { width: 1080, height: 1920, fps: 30, backgroundColor: '#000000' },
    } as never,
  })
})

describe('placeMedia', () => {
  it('puts a video, without its sound, on a track above the footage and under the captions', async () => {
    const [placed] = (await batch({
      op: 'placeMedia',
      mediaId: 'broll',
      from: 30,
      durationInFrames: 60,
      fit: 'cover',
      fadeInSeconds: 0.2,
    })) as [Placed]

    const order = trackOf(placed.trackId).order
    expect(order).toBeGreaterThan(-1)
    expect(order).toBeLessThan(0)
    expect(itemOf(placed.id)).toMatchObject({
      type: 'video',
      from: 30,
      durationInFrames: 60,
      embeddedAudioMuted: true,
      fadeIn: 0.2,
      // Cover: a 16:9 picture fills the 9:16 canvas's height.
      transform: { x: 0, y: 0, width: 3413, height: 1920 },
    })
    expect(items().filter((item) => item.type === 'audio')).toEqual([])
  })

  it('reuses that track for the next picture when it has room', async () => {
    const [first] = (await batch({
      op: 'placeMedia',
      mediaId: 'still',
      from: 0,
      durationInFrames: 30,
    })) as [Placed]
    const [second] = (await batch({
      op: 'placeMedia',
      mediaId: 'still',
      from: 60,
      durationInFrames: 30,
    })) as [Placed]
    const [overlapping] = (await batch({
      op: 'placeMedia',
      mediaId: 'still',
      from: 70,
      durationInFrames: 30,
    })) as [Placed]

    expect(second.trackId).toBe(first.trackId)
    expect(overlapping.trackId).not.toBe(first.trackId)
    expect(trackOf(overlapping.trackId).order).toBeGreaterThan(-1)
  })

  it('makes a new track on top of everything for newTrack: above', async () => {
    const [placed] = (await batch({
      op: 'placeMedia',
      mediaId: 'still',
      from: 0,
      durationInFrames: 30,
      newTrack: 'above',
    })) as [Placed]

    expect(trackOf(placed.trackId).order).toBeLessThan(-1)
  })

  it('puts sound on a track ripple edits leave alone, from a chosen point of the file', async () => {
    const [placed] = (await batch({
      op: 'placeMedia',
      mediaId: 'music',
      from: 0,
      durationInFrames: 300,
      newTrack: 'below',
      syncLock: false,
      volumeDb: -18,
      fadeInSeconds: 0.5,
      fadeOutSeconds: 1.5,
      sourceStartSeconds: 12,
    })) as [Placed]

    const music = itemOf(placed.id)
    expect(music).toMatchObject({
      type: 'audio',
      from: 0,
      durationInFrames: 300,
      volume: -18,
      audioFadeIn: 0.5,
      audioFadeOut: 1.5,
      sourceStart: 360,
    })
    expect(trackOf(placed.trackId)).toMatchObject({ kind: 'audio', syncLock: false })
    expect(trackOf(placed.trackId).order).toBeGreaterThan(1)
  })

  it('ends a placement at the end of the file', async () => {
    const [placed] = (await batch({
      op: 'placeMedia',
      mediaId: 'broll',
      from: 0,
      durationInFrames: 900,
      sourceStartSeconds: 4,
    })) as [Placed]

    expect(placed.durationInFrames).toBe(60)
  })

  it('refuses gain for a picture, and a track without room', async () => {
    await expect(
      batch({ op: 'placeMedia', mediaId: 'still', from: 0, durationInFrames: 30, volumeDb: -6 }),
    ).rejects.toThrow('placeMedia: `volumeDb` applies to sound; cover.png is placed without it')
    await expect(
      batch({ op: 'placeMedia', mediaId: 'still', from: 0, durationInFrames: 30, trackId: 'v1' }),
    ).rejects.toThrow('placeMedia: track "v1" has no room for 30 frames at frame 0')
  })
})
