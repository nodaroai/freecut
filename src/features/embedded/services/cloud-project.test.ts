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
// The media library the project file lists its media from.
vi.mock('../deps/media-library-contract', async () => {
  const { create } = await import('zustand')
  return {
    useMediaLibraryStore: create(() => ({
      currentProjectId: null as string | null,
      isLoading: false,
      mediaItems: [] as Array<Record<string, unknown>>,
    })),
  }
})
// The project store: the open project the revision counts for.
vi.mock('../deps/projects-contract', async () => {
  const { create } = await import('zustand')
  return {
    useProjectStore: create(() => ({
      currentProject: null as Record<string, unknown> | null,
    })),
  }
})
vi.mock('./studio-export-bridge', () => ({
  collectProjectJson: vi.fn(async () => ({ project: { id: 'p1' } })),
}))
vi.mock('./edit-readiness', () => ({ waitUntilEditable: vi.fn(async () => 'p1') }))
vi.mock('./timeline-report', () => ({ readTimeline: () => ({}) }))

import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { useMediaLibraryStore } from '../deps/media-library-contract'
import { useProjectStore } from '../deps/projects-contract'
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

const library = useMediaLibraryStore as unknown as {
  setState: (s: {
    currentProjectId?: string | null
    isLoading?: boolean
    mediaItems?: Array<Record<string, unknown>>
  }) => void
}
const clip = (id: string, fileName = `${id}.mp4`) => ({
  id,
  fileName,
  fileSize: 10,
  mimeType: 'video/mp4',
  duration: 2,
  width: 320,
  height: 180,
  fps: 30,
  codec: 'avc',
  bitrate: 1,
  thumbnailId: `thumb-${id}`,
})
/** The library of project `id` loading, then holding `items`. */
function loadLibrary(id: string, items: Array<Record<string, unknown>>) {
  library.setState({ currentProjectId: id, isLoading: true, mediaItems: [] })
  library.setState({ isLoading: false, mediaItems: items })
}

const projects = useProjectStore as unknown as {
  setState: (s: { currentProject: Record<string, unknown> | null }) => void
}
/** The project store holding project `id` as the open one. */
const openProject = (id: string | null, fields: Record<string, unknown> = {}) =>
  projects.setState({
    currentProject: id === null ? null : { id, name: `Project ${id}`, ...fields },
  })

beforeEach(() => {
  openProject('p1')
  library.setState({ currentProjectId: null, isLoading: false, mediaItems: [] })
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
      { type: 'FREECUT_PROJECT_CHANGED', payload: { revision: start + 1, projectId: 'p1' } },
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
      { type: 'FREECUT_PROJECT_CHANGED', payload: { revision: start + 1, projectId: 'p1' } },
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

  it('a change waiting when the open project changes is dropped, and the revision restarts', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    markDirty()
    vi.advanceTimersByTime(500)
    expect(currentRevision()).toBeGreaterThan(0)

    // A change to p1 is waiting when a load makes p2 the open project.
    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })
    openProject('p2')
    vi.advanceTimersByTime(600)
    expect(posted('FREECUT_PROJECT_CHANGED').map((m) => m.payload.projectId)).toEqual(['p1'])
    expect(currentRevision()).toBe(0)

    // The new project's first change is its revision 1.
    markDirty()
    vi.advanceTimersByTime(500)
    expect(posted('FREECUT_PROJECT_CHANGED').at(-1)!.payload).toEqual({
      revision: 1,
      projectId: 'p2',
    })
  })

  it('the editor leaving and coming back to the same project is not a switch', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    markDirty()
    vi.advanceTimersByTime(500)
    const before = currentRevision()

    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })
    openProject(null)
    openProject('p1')
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED').at(-1)!.payload).toEqual({
      revision: before + 1,
      projectId: 'p1',
    })
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
  // The editor shows p1.
  beforeEach(() => library.setState({ currentProjectId: 'p1' }))

  it('GET_PROJECT answers the project file, the current revision and the refs', async () => {
    claimImportedRef('r1')('m1')

    await handleGetProject(message('NODARO_GET_PROJECT', { requestId: 'g1' }))

    const replies = posted('FREECUT_PROJECT')
    expect(replies).toHaveLength(1)
    expect(replies[0]!.payload).toEqual({
      requestId: 'g1',
      revision: currentRevision(),
      projectId: 'p1',
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

describe('FREECUT_PROJECT_CHANGED for the media library', () => {
  it('an import announces once', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    loadLibrary('p1', [clip('a')])
    vi.advanceTimersByTime(500)
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(0)

    // NODARO_IMPORT_FILES, or the person's own import: the library reloads with one more.
    library.setState({ isLoading: true })
    library.setState({ isLoading: false, mediaItems: [clip('a'), clip('b')] })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1)
  })

  it('a delete, a rename and a relink each announce', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()
    loadLibrary('p1', [clip('a'), clip('b')])

    library.setState({ mediaItems: [clip('a')] })
    vi.advanceTimersByTime(500)
    library.setState({ mediaItems: [clip('a', 'renamed.mp4')] })
    vi.advanceTimersByTime(500)
    library.setState({ mediaItems: [{ ...clip('a', 'renamed.mp4'), fileSize: 99 }] })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(3)
  })

  it('loading or switching a project, or what the file does not list, announces nothing', () => {
    vi.useFakeTimers()
    stop = startProjectChangeAnnouncements()

    loadLibrary('p1', [clip('a')])
    loadLibrary('p2', [clip('x'), clip('y')])
    library.setState({ mediaItems: [{ ...clip('x'), thumbnailId: 'new-thumb' }, clip('y')] })
    library.setState({ currentProjectId: null, mediaItems: [] })
    vi.advanceTimersByTime(500)

    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(0)
  })
})
