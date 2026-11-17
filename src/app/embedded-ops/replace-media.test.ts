// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const MEDIA = vi.hoisted(() => {
  const video = (id: string, duration: number, width = 1920, height = 1080) => ({
    id,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    duration,
    width,
    height,
    fps: 30,
    audioCodec: 'aac',
  })
  return {
    take: video('take', 10),
    regraded: video('regraded', 12),
    short: video('short', 3),
    square: video('square', 12, 1080, 1080),
    tone: {
      id: 'tone',
      fileName: 'tone.wav',
      mimeType: 'audio/wav',
      duration: 30,
      width: 0,
      height: 0,
      fps: 0,
    },
  } as Record<string, Record<string, unknown>>
})
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: {
    getMedia: vi.fn(async (id: string) => MEDIA[id] ?? null),
    getThumbnailBlobUrl: vi.fn(async () => null),
  },
}))
vi.mock('@/features/media-library/utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn(async (id: string) => `blob:${id}`),
}))

import { claimImportedRef } from '@/features/embedded/services/imported-refs'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { TimelineItem } from '@/types/timeline'
import { embeddedEditOpEngine } from '../embedded-edit-ops'

type Op = Record<string, unknown> & { op: string }

async function batch(...ops: Op[]) {
  const prepared: Op[] = []
  for (const op of ops) prepared.push(await embeddedEditOpEngine.prepare(op))
  return useTimelineCommandStore
    .getState()
    .executeBatch({ type: 'APPLY_EDIT_OPS', payload: { count: ops.length } }, () =>
      prepared.map((op) => embeddedEditOpEngine.apply(op)),
    )
}

const clip = (
  id: string,
  type: 'video' | 'audio',
  from: number,
  sourceStart: number,
  trackId: string,
) =>
  ({
    id,
    type,
    trackId,
    from,
    durationInFrames: 60,
    label: 'take.mp4',
    src: 'blob:take',
    mediaId: 'take',
    linkedGroupId: `group-${from}`,
    sourceStart,
    sourceEnd: sourceStart + 60,
    sourceDuration: 300,
    sourceFps: 30,
    ...(type === 'video'
      ? { transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 } }
      : {}),
  }) as TimelineItem

const itemOf = (id: string) => useItemsStore.getState().itemById[id]!

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useItemsStore.getState().setTracks([
    {
      id: 'v1',
      name: 'V1',
      kind: 'video',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    },
    {
      id: 'a1',
      name: 'A1',
      kind: 'audio',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [],
    },
  ])
  // Two pieces of the take after a cut: 0–2 s and 6–8 s of the file.
  useItemsStore
    .getState()
    .setItems([
      clip('v-a', 'video', 0, 0, 'v1'),
      clip('a-a', 'audio', 0, 0, 'a1'),
      clip('v-b', 'video', 60, 180, 'v1'),
      clip('a-b', 'audio', 60, 180, 'a1'),
    ])
  useProjectStore.setState({
    currentProject: {
      id: 'p1',
      name: 'Take',
      metadata: { width: 1920, height: 1080, fps: 30 },
    } as never,
  })
})

describe('replaceMedia', () => {
  it('puts the new file under every clip, keeping where and what each one plays', async () => {
    const [result] = await batch({ op: 'replaceMedia', fromMediaId: 'take', toMediaId: 'regraded' })

    expect(result).toEqual({ ids: ['v-a', 'a-a', 'v-b', 'a-b'] })
    expect(itemOf('v-b')).toMatchObject({
      mediaId: 'regraded',
      src: 'blob:regraded',
      label: 'regraded.mp4',
      from: 60,
      durationInFrames: 60,
      sourceStart: 180,
      sourceEnd: 240,
      sourceDuration: 360,
      linkedGroupId: 'group-60',
    })
    expect(itemOf('a-b')).toMatchObject({ mediaId: 'regraded', sourceStart: 180, sourceEnd: 240 })
  })

  it('refits a picture that had the default fit when the new file has another shape', async () => {
    claimImportedRef('square-take')('square')
    await batch({ op: 'replaceMedia', fromMediaId: 'take', toRef: 'square-take' })

    expect(itemOf('v-a').transform).toMatchObject({ width: 1080, height: 1080 })
  })

  it('refuses a file shorter than the ranges the clips use', async () => {
    await expect(
      batch({ op: 'replaceMedia', fromMediaId: 'take', toMediaId: 'short' }),
    ).rejects.toThrow(
      'replaceMedia: short.mp4 is 3.00 s long, shorter than the 8.00 s the clips use',
    )
    expect(itemOf('v-a').mediaId).toBe('take')
  })

  it('refuses a sound file for video clips', async () => {
    await expect(
      batch({ op: 'replaceMedia', fromMediaId: 'take', toMediaId: 'tone' }),
    ).rejects.toThrow('replaceMedia: tone.wav has no picture for the video clips')
  })

  it('needs the new media', async () => {
    await expect(batch({ op: 'replaceMedia', fromMediaId: 'take' })).rejects.toThrow(
      'replaceMedia: needs `toMediaId` or `toRef`',
    )
  })
})
