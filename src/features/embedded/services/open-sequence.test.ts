import { beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({ pending: false }))
vi.mock('./edit-ops-bridge', () => ({ editRequestPending: () => bridge.pending }))

import {
  getActiveTabId,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useSequencesStore,
  useTimelineSettingsStore,
} from '../deps/timeline-contract'
import { useProjectStore } from '../deps/projects-contract'
import { openSequence } from './open-sequence'

const openTab = () => getActiveTabId(useCompositionNavigationStore.getState().breadcrumbs)

beforeEach(() => {
  bridge.pending = false
  useTimelineSettingsStore.setState({ fps: 30, isTimelineLoading: false })
  useItemsStore.getState().setTracks([])
  useItemsStore.getState().setItems([])
  useCompositionNavigationStore.getState().resetToRoot()
  useSequencesStore.getState().setTopLevelSequenceIds(['s1'])
  useCompositionsStore.getState().setCompositions([
    {
      id: 's1',
      name: 'Clip 1',
      editorKind: 'sequence',
      items: [],
      tracks: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 90,
    },
  ])
  useProjectStore.setState({
    currentProject: { id: 'p1', metadata: { width: 1920, height: 1080, fps: 30 } } as never,
  })
})

describe('open-sequence', () => {
  it('opens a sequence tab, and Main again', () => {
    expect(openSequence('s1')).toBe(true)
    expect(openTab()).toBe('s1')

    expect(openSequence('main')).toBe(true)
    expect(openTab()).toBeNull()
  })

  it('refuses while an edit request is not finished', () => {
    bridge.pending = true

    expect(openSequence('s1')).toBe(false)
    expect(openTab()).toBeNull()
  })

  it('refuses a name that is not a tab', () => {
    expect(openSequence('nope')).toBe(false)
    expect(openSequence(undefined)).toBe(false)
    expect(openTab()).toBeNull()
  })
})
