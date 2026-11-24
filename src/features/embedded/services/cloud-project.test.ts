import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-ins for the timeline stores the announcements watch: a dirty flag and
// an undo history, as small live stores so a change notifies subscribers. The
// snapshot stand-ins let an edit request without history (which may only add or
// remove timeline tabs) pass its check.
vi.mock('../deps/timeline-contract', async () => {
  const { create } = await import('zustand')
  type Entry = { command: { type: string } }
  const useTimelineSettingsStore = create(() => ({ isDirty: false }))
  const useTimelineCommandStore = create(() => ({
    undoStack: [] as Entry[],
    redoStack: [] as Entry[],
    stacksByContext: {},
    canUndo: false,
    canRedo: false,
    activeContextKey: '__root__',
    executeBatch: (_command: unknown, action: () => unknown) => action(),
  }))
  return {
    useTimelineSettingsStore,
    useTimelineCommandStore,
    useCompositionNavigationStore: { getState: () => ({ breadcrumbs: [] }) },
    getActiveTabId: () => null,
    captureSnapshot: () => ({ compositions: [], topLevelSequenceIds: [] }),
    restoreSnapshot: () => {},
    snapshotsEqual: () => true,
  }
})
vi.mock('./studio-export-bridge', () => ({
  collectProjectJson: vi.fn(async () => ({ project: { id: 'p1' } })),
}))
vi.mock('./edit-readiness', () => ({ waitUntilEditable: vi.fn(async () => 'p1') }))
vi.mock('./timeline-report', () => ({ readTimeline: () => ({}) }))

import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { currentRevision, handleGetProject, startProjectChangeAnnouncements } from './cloud-project'
import { handleApplyOps, setEditOpsLoader, type EditOp } from './edit-ops-bridge'
import { claimImportedRef } from './imported-refs'

// The stand-in history holds entries with a command alone.
type Entry = { command: { type: string } }
const history = useTimelineCommandStore as unknown as {
  setState: (state: {
    undoStack?: Entry[]
    redoStack?: Entry[]
    stacksByContext?: Record<string, unknown>
  }) => void
}

const ORIGIN = 'http://localhost:5173'
const message = (type: string, payload: Record<string, unknown>, origin = ORIGIN) =>
  new MessageEvent('message', { data: { type, payload }, origin })

type Posted = { type: string; payload: Record<string, unknown> }
let post: { mock: { calls: unknown[][] }; mockRestore: () => void }
let stop: () => void = () => {}
const posted = (type: string) =>
  post.mock.calls.map((call) => call[0] as Posted).filter((m) => m.type === type)

function markDirty() {
  useTimelineSettingsStore.setState({ isDirty: false })
  useTimelineSettingsStore.setState({ isDirty: true })
}

beforeEach(() => {
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  useEmbeddedStore.setState({ isEmbedded: true, parentOrigin: ORIGIN })
  useTimelineSettingsStore.setState({ isDirty: false })
  history.setState({ undoStack: [], redoStack: [] })
})
afterEach(() => {
  stop()
  post.mockRestore()
  vi.useRealTimers()
  setEditOpsLoader(null)
})

describe('FREECUT_PROJECT_CHANGED', () => {
  it('announces a change once per 500 ms with an increasing revision', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    const start = currentRevision()

    markDirty()
    vi.advanceTimersByTime(100)
    markDirty()
    vi.advanceTimersByTime(100)
    markDirty()
    vi.advanceTimersByTime(300)

    expect(posted('FREECUT_PROJECT_CHANGED')).toEqual([
      { type: 'FREECUT_PROJECT_CHANGED', payload: { revision: start + 1 } },
    ])
    expect(post.mock.calls[0]![1]).toBe(ORIGIN)

    markDirty()
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED').map((m) => m.payload.revision)).toEqual([
      start + 1,
      start + 2,
    ])
    expect(currentRevision()).toBe(start + 2)
  })

  it('does not announce outside embedded mode or before a parent origin is set', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()

    useEmbeddedStore.setState({ isEmbedded: false, parentOrigin: ORIGIN })
    markDirty()
    vi.advanceTimersByTime(500)
    useEmbeddedStore.setState({ isEmbedded: true, parentOrigin: null })
    markDirty()
    vi.advanceTimersByTime(500)

    expect(post).not.toHaveBeenCalled()
  })

  it('announces changes made before the parent origin was set once, when it is set', () => {
    vi.useFakeTimers()
    useEmbeddedStore.setState({ parentOrigin: null })
    stop = startProjectChangeAnnouncements()
    const start = currentRevision()

    markDirty()
    vi.advanceTimersByTime(500)
    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })
    vi.advanceTimersByTime(500)
    expect(post).not.toHaveBeenCalled()

    useEmbeddedStore.setState({ parentOrigin: ORIGIN })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toEqual([
      { type: 'FREECUT_PROJECT_CHANGED', payload: { revision: start + 1 } },
    ])
    expect(post.mock.calls[0]![1]).toBe(ORIGIN)
  })

  it('announces an edit request applied without history while the timeline is already dirty', async () => {
    useTimelineSettingsStore.setState({ isDirty: true })
    setEditOpsLoader(async () => ({ prepare: async (op: EditOp) => op, apply: () => null }))
    stop = startProjectChangeAnnouncements()
    vi.useFakeTimers()

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'e0', history: false, ops: [{ op: 'x' }] }),
    )
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_OPS_RESULT')[0]!.payload).toMatchObject({ ok: true, recorded: false })
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1)
  })

  it('does not announce the history being cleared when a project loads', () => {
    vi.useFakeTimers()
    const entry = { command: { type: 'MOVE_ITEM' } }
    history.setState({ undoStack: [entry], redoStack: [entry] })
    useTimelineSettingsStore.setState({ isDirty: true })
    stop = startProjectChangeAnnouncements()

    history.setState({ undoStack: [], redoStack: [], stacksByContext: {} })
    vi.advanceTimersByTime(500)

    expect(post).not.toHaveBeenCalled()
  })

  it('announces an edit made while the timeline is already dirty', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    useTimelineSettingsStore.setState({ isDirty: true })
    vi.advanceTimersByTime(500)
    const before = posted('FREECUT_PROJECT_CHANGED').length

    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(before + 1)
  })

  it('an edit past the history cap is still announced', () => {
    vi.useFakeTimers()
    const full = Array.from({ length: 50 }, (_, i) => ({ command: { type: `EDIT_${i}` } }))
    history.setState({ undoStack: full })
    useTimelineSettingsStore.setState({ isDirty: true })
    stop = startProjectChangeAnnouncements()

    // The store keeps 50 entries: a new edit drops the oldest, so the length stays.
    history.setState({
      undoStack: [...full.slice(1), { command: { type: 'EDIT_50' } }],
    })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1)
  })

  it('announces undo and redo', () => {
    vi.useFakeTimers()
    const entry = { command: { type: 'MOVE_ITEM' } }
    history.setState({ undoStack: [entry] })
    useTimelineSettingsStore.setState({ isDirty: true })
    stop = startProjectChangeAnnouncements()

    history.setState({ undoStack: [], redoStack: [entry] })
    vi.advanceTimersByTime(500)
    history.setState({ undoStack: [entry], redoStack: [] })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(2)
  })

  it('stops announcing once stopped, and starting twice announces once', () => {
    vi.useFakeTimers()
    const stopFirst = startProjectChangeAnnouncements()
    const stopSecond = startProjectChangeAnnouncements()

    markDirty()
    vi.advanceTimersByTime(500)
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1)

    stopFirst()
    stopSecond()
    markDirty()
    vi.advanceTimersByTime(500)
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1)
  })
})

describe('NODARO_GET_PROJECT', () => {
  it('GET_PROJECT answers the project file, the current revision and the refs', async () => {
    claimImportedRef('r1')('m1')

    await handleGetProject(message('NODARO_GET_PROJECT', { requestId: 'g1' }))

    const replies = posted('FREECUT_PROJECT')
    expect(replies).toHaveLength(1)
    expect(replies[0]!.payload).toEqual({
      requestId: 'g1',
      revision: currentRevision(),
      projectJson: { project: { id: 'p1' } },
      refs: { m1: 'r1' },
    })
    expect(post.mock.calls.at(-1)![1]).toBe(ORIGIN)
  })

  it('GET_PROJECT replies to the origin that asked', async () => {
    useEmbeddedStore.setState({ parentOrigin: null })

    await handleGetProject(
      message('NODARO_GET_PROJECT', { requestId: 'g3' }, 'https://studio.nodaro.ai'),
    )

    expect(posted('FREECUT_PROJECT')).toHaveLength(1)
    expect(post.mock.calls.at(-1)![1]).toBe('https://studio.nodaro.ai')
  })

  it('GET_PROJECT is queued behind a running edit request', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    setEditOpsLoader(async () => ({
      prepare: async (op: EditOp) => {
        await gate
        return op
      },
      apply: () => null,
    }))

    const edit = handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'e1', ops: [{ op: 'x' }] }),
    )
    const get = handleGetProject(message('NODARO_GET_PROJECT', { requestId: 'g2' }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(posted('FREECUT_PROJECT')).toHaveLength(0)

    release()
    await Promise.all([edit, get])

    const order = post.mock.calls.map((call) => (call[0] as Posted).type)
    expect(order.indexOf('FREECUT_OPS_RESULT')).toBeLessThan(order.indexOf('FREECUT_PROJECT'))
  })
})
