import { beforeEach, describe, expect, it } from 'vitest'
import type { TimelineItem } from '@/types/timeline'
import {
  useCompositionsStore,
  useItemsStore,
  useSequencesStore,
  useTimelineCommandStore,
} from '../deps/timeline-contract'
import { executeWithoutHistory } from './history-free-batch'

const tab = (id: string) => ({
  id,
  name: id,
  editorKind: 'sequence' as const,
  items: [],
  tracks: [],
  transitions: [],
  keyframes: [],
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 30,
})

const clip = {
  id: 'c1',
  type: 'text',
  trackId: 't1',
  from: 0,
  durationInFrames: 30,
  label: 'T',
  text: 'T',
  color: '#fff',
} as TimelineItem

const addTab = (id: string) => () => {
  useCompositionsStore.getState().addComposition(tab(id))
  useSequencesStore.getState().addTopLevelSequence(id)
}

const tabIds = () => useSequencesStore.getState().topLevelSequenceIds
const history = () => useTimelineCommandStore.getState()

beforeEach(() => {
  history().clearHistory()
  useItemsStore.getState().setItems([])
  useCompositionsStore.getState().setCompositions([])
  useSequencesStore.getState().reset()
  // An earlier edit of the open timeline, on the undo stack.
  history().execute({ type: 'ADD_ITEM' }, () => useItemsStore.getState().setItems([clip]))
})

describe('a request without history', () => {
  it('adds a tab without an undo entry, and undoing an earlier edit keeps it', () => {
    executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, addTab('s1'))

    expect(history().undoStack.map((entry) => entry.command.type)).toEqual(['ADD_ITEM'])
    history().undo()
    expect(useItemsStore.getState().items).toEqual([])
    expect(tabIds()).toEqual(['s1'])
    history().redo()
    expect(tabIds()).toEqual(['s1'])
    expect(useItemsStore.getState().items).toEqual([clip])
  })

  it('removes a tab so that undoing an earlier edit does not bring it back', () => {
    executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, addTab('s1'))
    executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, () => {
      useCompositionsStore.getState().removeComposition('s1')
      useSequencesStore.getState().removeTopLevelSequence('s1')
    })

    history().undo()
    expect(tabIds()).toEqual([])
    expect(useCompositionsStore.getState().compositions).toEqual([])
  })

  it('refuses and takes back a request that changed the open timeline', () => {
    expect(() =>
      executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, () => {
        addTab('s1')()
        useItemsStore.getState().setItems([])
      }),
    ).toThrow('history: false only adds or removes timeline tabs that are not open')

    expect(useItemsStore.getState().items).toEqual([clip])
    expect(tabIds()).toEqual([])
    expect(history().undoStack.map((entry) => entry.command.type)).toEqual(['ADD_ITEM'])
  })

  it('rolls back a request whose operation fails', () => {
    expect(() =>
      executeWithoutHistory({ type: 'APPLY_EDIT_OPS' }, () => {
        addTab('s1')()
        throw new Error('the second operation failed')
      }),
    ).toThrow('the second operation failed')

    expect(tabIds()).toEqual([])
  })
})
