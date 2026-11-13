// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Undo restores into the domain stores, and restoring project metadata writes it
// back through storage — mock the storage write only.
const indexedDbMocks = vi.hoisted(() => ({
  updateProject: vi.fn(),
}))

vi.mock('@/infrastructure/storage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    ...indexedDbMocks,
  }
})

import { resetTimelineCompositionTestState, setTimelineState } from '../test-helpers'
import { useItemsStore } from './items-store'
import { useTimelineCommandStore } from './timeline-command-store'
import { captureSnapshot } from './commands/snapshot'
import { updateItem } from './actions/item-actions'

function seedOneClip() {
  setTimelineState({
    tracks: [
      {
        id: 'track-a1',
        name: 'A1',
        kind: 'audio',
        height: 80,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ],
    items: [
      {
        id: 'audio-1',
        type: 'audio',
        trackId: 'track-a1',
        from: 0,
        durationInFrames: 90,
        label: 'voiceover.wav',
        src: 'blob:audio',
        mediaId: 'media-a1',
        volume: 0,
      },
    ],
  })
}

const BATCH = { type: 'APPLY_EDIT_OPS', payload: { count: 2 } }
const undoDepth = () => useTimelineCommandStore.getState().undoStack.length

describe('timeline-command-store executeBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetTimelineCompositionTestState()
    seedOneClip()
  })

  it('records every action inside the batch as one undo entry', () => {
    const before = undoDepth()

    useTimelineCommandStore.getState().executeBatch(BATCH, () => {
      updateItem('audio-1', { volume: -6 })
      updateItem('audio-1', { label: 'voice.wav' })
    })

    expect(undoDepth()).toBe(before + 1)
    useTimelineCommandStore.getState().undo()
    const item = useItemsStore.getState().itemById['audio-1']
    expect(item?.volume).toBe(0)
    expect(item?.label).toBe('voiceover.wav')
  })

  it('restores the timeline and records nothing when the batch throws', () => {
    const before = undoDepth()

    expect(() =>
      useTimelineCommandStore.getState().executeBatch(BATCH, () => {
        updateItem('audio-1', { volume: -6 })
        throw new Error('the second operation failed')
      }),
    ).toThrow('the second operation failed')

    expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(0)
    expect(undoDepth()).toBe(before)
  })

  it('records nothing for a batch that changes nothing', () => {
    const before = undoDepth()

    const result = useTimelineCommandStore.getState().executeBatch(BATCH, () => 'unchanged')

    expect(result).toBe('unchanged')
    expect(undoDepth()).toBe(before)
  })

  it('folds a pre-captured entry made inside the batch into the batch', () => {
    const before = undoDepth()
    const store = useTimelineCommandStore.getState()

    store.executeBatch(BATCH, () => {
      updateItem('audio-1', { volume: -6 })
      const dragStart = captureSnapshot()
      useItemsStore.getState()._updateItem('audio-1', { label: 'dragged.wav' })
      store.addUndoEntry({ type: 'DRAG' }, dragStart)
    })

    expect(undoDepth()).toBe(before + 1)
    useTimelineCommandStore.getState().undo()
    const item = useItemsStore.getState().itemById['audio-1']
    expect(item?.volume).toBe(0)
    expect(item?.label).toBe('voiceover.wav')
  })

  it('records ordinary commands again once the batch is over', () => {
    const before = undoDepth()

    useTimelineCommandStore
      .getState()
      .executeBatch(BATCH, () => updateItem('audio-1', { volume: -6 }))
    updateItem('audio-1', { volume: -3 })

    expect(undoDepth()).toBe(before + 2)
  })
})
