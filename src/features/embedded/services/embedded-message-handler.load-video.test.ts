import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// NODARO_LOAD_VIDEO ends by opening the new project in the editor. A feature
// never imports the app's router, so the app shell passes in how to open it
// (initEmbeddedMessageHandler's openEditor). The project store stands in as a
// live store whose createProject makes the new project current, as the real
// one does.
vi.mock('../deps/projects-contract', async () => {
  const { create } = await import('zustand')
  type P = { id: string }
  let next = 0
  const useProjectStore = create(() => ({
    currentProject: null as P | null,
    projects: [] as P[],
    createProject: vi.fn(async () => {
      next += 1
      const project = { id: `project-${next}` }
      useProjectStore.setState({ currentProject: project })
      return project
    }),
  }))
  return { useProjectStore }
})
vi.mock('../deps/media-library-contract', async () => {
  const { create } = await import('zustand')
  let next = 0
  return {
    mediaLibraryService: {
      importMediaBlob: vi.fn(async () => {
        next += 1
        return { id: `media-${next}` }
      }),
    },
    mediaProcessorService: {
      processMedia: vi.fn(async () => ({
        metadata: { type: 'video', width: 320, height: 180, fps: 30, codec: 'avc' },
      })),
    },
    useMediaLibraryStore: create(() => ({
      currentProjectId: null,
      isLoading: false,
      mediaItems: [],
      loadMediaItems: async () => {},
    })),
  }
})
vi.mock('./embedded-workspace', () => ({ ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}) }))
vi.mock('./timeline-add', () => ({
  addMediaToTimelineAtPlayhead: vi.fn(async () => ({ track: 'A1', at: 0 })),
}))
vi.mock('@/infrastructure/storage', () => ({ updateProject: vi.fn(), getProject: vi.fn() }))

import { useProjectStore } from '../deps/projects-contract'
import { mediaLibraryService } from '../deps/media-library-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { useTimelineSettingsStore } from '../deps/timeline-contract'
import { currentRevision } from './cloud-project'
import { initEmbeddedMessageHandler } from './embedded-message-handler'
import { claimImportedRef, refsByMediaId } from './imported-refs'

const ORIGIN = 'https://app.nodaro.ai'
const openEditor = vi.fn()
let post: ReturnType<typeof vi.spyOn>

const send = (type: string, payload: Record<string, unknown>) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      // The framing page is the sender; under jsdom the window is its own parent.
      source: window,
      data: { type, payload },
    }),
  )
type Posted = { type: string; payload: Record<string, unknown> }
const posted = (type: string) =>
  post.mock.calls.map((call: unknown[]) => call[0] as Posted).filter((m: Posted) => m.type === type)
const currentId = () => useProjectStore.getState().currentProject?.id ?? null

beforeAll(() => {
  initEmbeddedMessageHandler({ openEditor, saveLocation: () => () => {} })
})
beforeEach(() => {
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  openEditor.mockReset()
  useEmbeddedStore.setState({ isImporting: false, pendingVideoImport: null })
  useProjectStore.setState({ currentProject: { id: 'previous' } as never })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['video'], { type: 'video/mp4' }))),
  )
})

describe('NODARO_LOAD_VIDEO opens the editor through the app shell', () => {
  it('an empty boot opens the new project with the openEditor the app passed in', async () => {
    send('NODARO_LOAD_VIDEO', {})

    await vi.waitFor(() => expect(openEditor).toHaveBeenCalledWith(expect.any(String)))
    expect(currentId()).toBe(openEditor.mock.calls[0]![0])
  })
})

describe('NODARO_LOAD_VIDEO replaces the open project only when it opens the new one', () => {
  it('a successful load clears the refs, and makes the new project current as it opens it', async () => {
    claimImportedRef('r-old')('m-old')
    let atOpen: { current: string | null; refs: Record<string, string> } | null = null
    openEditor.mockImplementation(() => {
      atOpen = { current: currentId(), refs: refsByMediaId() }
    })

    send('NODARO_LOAD_VIDEO', { videoUrl: 'https://cdn.example/a.mp4' })

    await vi.waitFor(() => expect(openEditor).toHaveBeenCalledOnce())
    const opened = openEditor.mock.calls[0]![0] as string
    expect(atOpen).toEqual({ current: opened, refs: {} })
  })

  it('a failed load keeps the previous project and its refs, and a ref still places', async () => {
    claimImportedRef('r-kept')('m-kept')
    vi.mocked(mediaLibraryService.importMediaBlob).mockRejectedValueOnce(new Error('cannot decode'))

    send('NODARO_LOAD_VIDEO', { videoUrl: 'https://cdn.example/broken.mp4' })

    await vi.waitFor(() => expect(posted('FREECUT_ERROR')).toHaveLength(1))
    expect(openEditor).not.toHaveBeenCalled()
    expect(currentId()).toBe('previous')
    expect(refsByMediaId()).toEqual({ 'm-kept': 'r-kept' })

    send('NODARO_ADD_TO_TIMELINE', { requestId: 'add-1', ref: 'r-kept' })
    await vi.waitFor(() => expect(posted('FREECUT_TIMELINE_ADDED')).toHaveLength(1))
  })

  it("a failed load leaves the previous project's waiting change and revision as they were", async () => {
    useEmbeddedStore.setState({ isEmbedded: true, parentOrigin: ORIGIN })
    useTimelineSettingsStore.setState({ isDirty: false })
    useTimelineSettingsStore.setState({ isDirty: true })
    await vi.waitFor(() => expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(1))
    const before = currentRevision()
    // A change of the previous project is waiting when the load starts, and the load fails.
    useTimelineSettingsStore.setState({ isDirty: false })
    useTimelineSettingsStore.setState({ isDirty: true })
    vi.mocked(mediaLibraryService.importMediaBlob).mockRejectedValueOnce(new Error('cannot decode'))

    send('NODARO_LOAD_VIDEO', { videoUrl: 'https://cdn.example/broken.mp4' })

    await vi.waitFor(() => expect(posted('FREECUT_ERROR')).toHaveLength(1))
    await vi.waitFor(() => expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(2), {
      timeout: 2000,
    })
    expect(posted('FREECUT_PROJECT_CHANGED').at(-1)!.payload).toEqual({
      revision: before + 1,
      projectId: 'previous',
    })
  })

  it('NODARO_RESET_PROJECT keeps the refs: the project open stays open', () => {
    claimImportedRef('r-reset')('m-reset')

    send('NODARO_RESET_PROJECT', {})

    expect(refsByMediaId()).toMatchObject({ 'm-reset': 'r-reset' })
  })

  it('files imported while a load runs go into the loaded project', async () => {
    let release: () => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new Response(new Blob(['video'], { type: 'video/mp4' })))
          }),
      ),
    )

    send('NODARO_LOAD_VIDEO', { videoUrl: 'https://cdn.example/slow.mp4' })
    send('NODARO_IMPORT_FILES', {
      files: [{ name: 'extra.mp4', type: 'video/mp4', buffer: new ArrayBuffer(1), ref: 'r-x' }],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()

    await vi.waitFor(() => expect(openEditor).toHaveBeenCalledOnce(), { timeout: 3000 })
    const loaded = openEditor.mock.calls[0]![0] as string
    await vi.waitFor(
      () =>
        expect(mediaLibraryService.importMediaBlob).toHaveBeenCalledWith(
          expect.any(Blob),
          loaded,
          'extra.mp4',
        ),
      { timeout: 3000 },
    )
  })
})
