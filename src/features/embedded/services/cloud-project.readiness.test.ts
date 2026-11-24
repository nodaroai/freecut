import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NODARO_GET_PROJECT hands over exactly the project the editor shows, so it
// answers only once the editor shows the open project fully loaded. These
// stand-ins are the stores that say what the editor shows; saving the
// timeline and reading the project file are spies.
vi.mock('../deps/projects-contract', async () => {
  const { create } = await import('zustand')
  return {
    useProjectStore: create(() => ({
      currentProject: null as { id: string } | null,
    })),
  }
})
vi.mock('../deps/media-library-contract', async () => {
  const { create } = await import('zustand')
  return {
    useMediaLibraryStore: create(() => ({
      currentProjectId: null as string | null,
      isLoading: false,
      mediaItems: [],
    })),
  }
})
vi.mock('../deps/timeline-contract', async () => {
  const { create } = await import('zustand')
  return {
    useTimelineSettingsStore: create(() => ({ isDirty: false, isTimelineLoading: false })),
    useTimelineCommandStore: create(() => ({
      undoStack: [],
      redoStack: [],
      activeContextKey: '__root__',
    })),
    useCompositionNavigationStore: { getState: () => ({ breadcrumbs: [] }) },
    getActiveTabId: () => null,
    saveTimeline: vi.fn(async () => {}),
  }
})
vi.mock('../deps/project-bundle-contract', () => ({
  exportProjectJson: vi.fn(async (projectId: string) => ({ project: { id: projectId } })),
}))
vi.mock('./timeline-report', () => ({ readTimeline: () => ({}) }))

import { useProjectStore } from '../deps/projects-contract'
import { useMediaLibraryStore } from '../deps/media-library-contract'
import { saveTimeline, useTimelineSettingsStore } from '../deps/timeline-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { handleGetProject } from './cloud-project'
import { trackProjectLoad } from './project-load'

const ORIGIN = 'http://localhost:5173'
type Posted = { type: string; payload: Record<string, unknown> }
let post: { mock: { calls: unknown[][] }; mockRestore: () => void }
const replies = () =>
  post.mock.calls.map((call) => call[0] as Posted).filter((m) => m.type === 'FREECUT_PROJECT')

/** The project store's open project and the project the editor is on. */
function editorOn(open: string | null, shown: string | null = open) {
  useProjectStore.setState({ currentProject: open === null ? null : ({ id: open } as never) })
  useMediaLibraryStore.setState({ currentProjectId: shown })
}
const loading = (isTimelineLoading: boolean) =>
  useTimelineSettingsStore.setState({ isTimelineLoading })

/** Asks for the project, and runs the fake clock until it is answered. */
async function getProject(requestId: string) {
  const asked = handleGetProject(
    new MessageEvent('message', {
      data: { type: 'NODARO_GET_PROJECT', payload: { requestId } },
      origin: ORIGIN,
    }),
  )
  let done = false
  void asked.then(() => (done = true))
  for (let i = 0; !done && i < 200; i++) await vi.advanceTimersByTimeAsync(100)
  await asked
  return replies().at(-1)!.payload
}

const notReady = (requestId: string, projectId: string | null) => ({
  requestId,
  revision: expect.any(Number),
  projectId,
  projectJson: null,
  notReady: true,
})

beforeEach(() => {
  vi.useFakeTimers()
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  useEmbeddedStore.setState({ isEmbedded: true, isImporting: false, pendingVideoImport: null })
  editorOn('p1')
  loading(false)
  vi.mocked(saveTimeline).mockClear()
})
afterEach(() => {
  post.mockRestore()
  vi.useRealTimers()
})

describe('NODARO_GET_PROJECT answers only the project the editor shows', () => {
  it('hands over the open project once the editor shows it', async () => {
    expect(await getProject('g1')).toMatchObject({
      requestId: 'g1',
      projectId: 'p1',
      projectJson: { project: { id: 'p1' } },
    })
    expect(saveTimeline).toHaveBeenCalledWith('p1')
  })

  it('during a NODARO_LOAD_VIDEO it answers not ready and saves nothing', async () => {
    // The load made p2 the open project; the editor is still on p1.
    let finish: () => void = () => {}
    trackProjectLoad(new Promise<void>((resolve) => (finish = resolve)))
    editorOn('p2', 'p1')

    expect(await getProject('g2')).toEqual(notReady('g2', null))
    expect(saveTimeline).not.toHaveBeenCalled()
    finish()
  })

  it("during the editor's own timeline load it answers not ready and saves nothing", async () => {
    loading(true)

    expect(await getProject('g3')).toEqual(notReady('g3', 'p1'))
    expect(saveTimeline).not.toHaveBeenCalled()
  })

  it('waits for a timeline load that ends within 10 s, then hands over the project', async () => {
    loading(true)
    setTimeout(() => loading(false), 3_000)

    expect(await getProject('g4')).toMatchObject({ projectId: 'p1', projectJson: { project: {} } })
    expect(saveTimeline).toHaveBeenCalledOnce()
  })

  it('answers not ready at once when no project is open', async () => {
    editorOn(null)

    expect(await getProject('g5')).toEqual(notReady('g5', null))
    expect(saveTimeline).not.toHaveBeenCalled()
  })
})
