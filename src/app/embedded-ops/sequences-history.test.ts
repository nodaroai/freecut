// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

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

import { executeWithoutHistory } from '@/features/embedded/services/history-free-batch'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
import { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useSequencesStore } from '@/features/timeline/stores/sequences-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { TimelineItem } from '@/types/timeline'
import { embeddedEditOpEngine } from '../embedded-edit-ops'

type Op = Record<string, unknown> & { op: string }

/** Ops applied as the bridge applies a request with `history: false`. */
async function withoutHistory(...ops: Op[]) {
  const prepared: Op[] = []
  for (const op of ops) prepared.push(await embeddedEditOpEngine.prepare(op))
  return executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, () =>
    prepared.map((op) => embeddedEditOpEngine.apply(op)),
  ) as unknown[]
}

const clip = { mediaId: 'take', sourceStart: 0, sourceEnd: 1 }
const tabIds = () => useSequencesStore.getState().topLevelSequenceIds
const history = () => useTimelineCommandStore.getState()
const text = {
  id: 't1',
  type: 'text',
  trackId: 'v1',
  from: 0,
  durationInFrames: 30,
  label: 'T',
  text: 'T',
  color: '#fff',
} as TimelineItem

beforeEach(() => {
  history().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useItemsStore.getState().setTracks([])
  useItemsStore.getState().setItems([])
  useCompositionsStore.getState().setCompositions([])
  useSequencesStore.getState().reset()
  useCompositionNavigationStore.getState().resetToRoot()
  useProjectStore.setState({
    currentProject: { id: 'p1', metadata: { width: 1920, height: 1080, fps: 30 } } as never,
  })
  // An earlier edit of Main, on its undo stack.
  history().execute({ type: 'ADD_ITEM' }, () => useItemsStore.getState().setItems([text]))
})

describe('timeline tabs without history', () => {
  it('creates and removes tabs with no undo entry, and an earlier undo leaves the tabs as they are', async () => {
    const [first] = (await withoutHistory({
      op: 'createSequence',
      name: 'One',
      pieces: [clip],
    })) as [{ sequenceId: string }]
    const [second] = (await withoutHistory({
      op: 'createSequence',
      name: 'Two',
      pieces: [clip],
    })) as [{ sequenceId: string }]

    await withoutHistory({ op: 'removeSequence', sequenceId: first.sequenceId })

    expect(tabIds()).toEqual([second.sequenceId])
    expect(history().undoStack.map((entry) => entry.command.type)).toEqual(['ADD_ITEM'])
    history().undo()
    expect(useItemsStore.getState().items).toEqual([])
    expect(tabIds()).toEqual([second.sequenceId])
    expect(useCompositionsStore.getState().compositions.map((c) => c.name)).toEqual(['Two'])
  })

  it('refuses to remove, without history, a tab that a timeline uses as a clip', async () => {
    const [made] = (await withoutHistory({
      op: 'createSequence',
      name: 'One',
      pieces: [clip],
    })) as [{ sequenceId: string }]
    useItemsStore.getState().setItems([
      {
        ...text,
        id: 'nest',
        type: 'composition',
        compositionId: made.sequenceId,
      } as unknown as TimelineItem,
    ])

    await expect(
      withoutHistory({ op: 'removeSequence', sequenceId: made.sequenceId }),
    ).rejects.toThrow('history: false only adds or removes timeline tabs that are not open')
    expect(tabIds()).toEqual([made.sequenceId])
  })
})
