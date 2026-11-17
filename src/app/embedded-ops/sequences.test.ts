// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Media files the stand-in storage answers for.
const MEDIA = vi.hoisted(
  () =>
    ({
      take: {
        id: 'take',
        fileName: 'take.mp4',
        mimeType: 'video/mp4',
        duration: 20,
        width: 1920,
        height: 1080,
        fps: 30,
        audioCodec: 'aac',
      },
      still: {
        id: 'still',
        fileName: 'cover.png',
        mimeType: 'image/png',
        duration: 0,
        width: 1080,
        height: 1350,
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
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useSequencesStore } from '@/features/timeline/stores/sequences-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { claimImportedRef } from '@/features/embedded/services/imported-refs'
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

const sequence = (id: string) => useCompositionsStore.getState().compositionById[id]!

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useItemsStore.getState().setTracks([])
  useItemsStore.getState().setItems([])
  useCompositionsStore.getState().setCompositions([])
  useSequencesStore.getState().reset()
  useCompositionNavigationStore.getState().resetToRoot()
  useProjectStore.setState({
    currentProject: {
      id: 'p1',
      name: 'Take',
      metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
    } as never,
  })
})

describe('createSequence', () => {
  it('builds a tab with the pieces back to back on V1 and their sound on A1, and stays on Main', async () => {
    const [result] = (await batch({
      op: 'createSequence',
      name: 'Clip 1',
      width: 1080,
      height: 1920,
      pieces: [
        { mediaId: 'take', sourceStart: 2, sourceEnd: 5 },
        { mediaId: 'take', sourceStart: 10, sourceEnd: 12.5 },
      ],
    })) as [{ sequenceId: string; durationInFrames: number }]

    expect(result.durationInFrames).toBe(165)
    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual([result.sequenceId])
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()

    const created = sequence(result.sequenceId)
    expect(created).toMatchObject({ name: 'Clip 1', width: 1080, height: 1920, fps: 30 })
    expect(created.tracks.map((track) => [track.name, track.kind])).toEqual([
      ['V1', 'video'],
      ['A1', 'audio'],
    ])
    const [v1, a1] = created.tracks
    const spans = created.items.map((item) => [
      item.type,
      item.trackId === v1!.id ? 'V1' : item.trackId === a1!.id ? 'A1' : '?',
      item.from,
      item.durationInFrames,
      item.sourceStart,
      item.sourceEnd,
    ])
    expect(spans).toEqual([
      ['video', 'V1', 0, 90, 60, 150],
      ['audio', 'A1', 0, 90, 60, 150],
      ['video', 'V1', 90, 75, 300, 375],
      ['audio', 'A1', 90, 75, 300, 375],
    ])
    // Each picture is linked to its own sound, as a media-bin drop links them.
    expect(created.items[0]!.linkedGroupId).toBe(created.items[1]!.linkedGroupId)
    expect(created.items[0]!.linkedGroupId).not.toBe(created.items[2]!.linkedGroupId)
  })

  it('frames a piece with its transform, and lasts an image the seconds asked', async () => {
    claimImportedRef('cover')('still')
    const [result] = (await batch({
      op: 'createSequence',
      name: 'Vertical',
      width: 1080,
      height: 1920,
      pieces: [
        {
          mediaId: 'take',
          sourceStart: 0,
          sourceEnd: 1,
          transform: { x: -120, y: 0, width: 3413, height: 1920 },
        },
        { ref: 'cover', sourceStart: 0, sourceEnd: 2 },
      ],
    })) as [{ sequenceId: string; durationInFrames: number }]

    const items = sequence(result.sequenceId).items
    expect(items[0]!.transform).toMatchObject({ x: -120, y: 0, width: 3413, height: 1920 })
    expect(items.at(-1)).toMatchObject({ type: 'image', from: 30, durationInFrames: 60 })
    expect(result.durationInFrames).toBe(90)
  })

  it('is undone with its batch', async () => {
    await batch({
      op: 'createSequence',
      name: 'Gone',
      pieces: [{ mediaId: 'take', sourceStart: 0, sourceEnd: 1 }],
    })
    useTimelineCommandStore.getState().undo()

    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual([])
    expect(useCompositionsStore.getState().compositions).toEqual([])
  })

  it('refuses a range past the end of the file', async () => {
    await expect(
      batch({
        op: 'createSequence',
        name: 'Too long',
        pieces: [{ mediaId: 'take', sourceStart: 18, sourceEnd: 25 }],
      }),
    ).rejects.toThrow('createSequence: pieces[0] ends at 25 s, past the end of take.mp4 (20 s)')
  })
})

describe('removeSequence', () => {
  it('deletes a tab that is not open', async () => {
    const [created] = (await batch({
      op: 'createSequence',
      name: 'Clip',
      pieces: [{ mediaId: 'take', sourceStart: 0, sourceEnd: 1 }],
    })) as [{ sequenceId: string }]

    await batch({ op: 'removeSequence', sequenceId: created.sequenceId })

    expect(useSequencesStore.getState().topLevelSequenceIds).toEqual([])
    expect(useCompositionsStore.getState().compositionById[created.sequenceId]).toBeUndefined()
  })

  it('refuses the open tab', async () => {
    const [created] = (await batch({
      op: 'createSequence',
      name: 'Clip',
      pieces: [{ mediaId: 'take', sourceStart: 0, sourceEnd: 1 }],
    })) as [{ sequenceId: string }]
    useCompositionNavigationStore.getState().switchToSequence(created.sequenceId)

    await expect(batch({ op: 'removeSequence', sequenceId: created.sequenceId })).rejects.toThrow(
      'removeSequence: the open timeline tab cannot be removed',
    )
  })

  it('refuses an id that is not a tab', async () => {
    await expect(batch({ op: 'removeSequence', sequenceId: 'nope' })).rejects.toThrow(
      'removeSequence: sequence "nope" is not a timeline tab',
    )
  })
})
