import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stand-ins for what an open touches: the project store and the storage it
// writes the restored project to, the media library it imports into, and the
// timeline stores the change announcements watch. `openEditor` stands in for
// the editor mounting the project: it hydrates the timeline from storage.
const db = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('@/infrastructure/storage', () => ({
  updateProject: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    db.set(id, { ...db.get(id), ...patch })
  }),
  getProject: vi.fn(async (id: string) => db.get(id)),
}))
vi.mock('../deps/projects-contract', async () => {
  const { create } = await import('zustand')
  type P = Record<string, unknown> & { id: string }
  let next = 0
  const useProjectStore = create(() => ({
    currentProject: null as P | null,
    projects: [] as P[],
    createProject: vi.fn(
      async (data: { name: string; width: number; height: number; fps: number }) => {
        next += 1
        const project = {
          id: `fresh-${next}`,
          name: data.name,
          description: '',
          createdAt: 1,
          updatedAt: 1,
          duration: 0,
          schemaVersion: 15,
          metadata: { width: data.width, height: data.height, fps: data.fps },
        }
        db.set(project.id, project)
        useProjectStore.setState({ currentProject: project })
        return project
      },
    ),
  }))
  return { useProjectStore }
})
vi.mock('../deps/media-library-contract', async () => {
  const { create } = await import('zustand')
  return {
    mediaLibraryService: {
      importMediaBlob: vi.fn(async (_blob: Blob, _projectId: string, name: string) => ({
        id: `new-${name}`,
      })),
    },
    mediaProcessorService: {},
    useMediaLibraryStore: create(() => ({ currentProjectId: null as string | null })),
  }
})
vi.mock('../deps/timeline-contract', async () => {
  const { create } = await import('zustand')
  type Entry = { command: { type: string } }
  const useTimelineSettingsStore = create(() => ({
    isDirty: false,
    isTimelineLoading: false,
    markClean: () => useTimelineSettingsStore.setState({ isDirty: false }),
  }))
  const useTimelineCommandStore = create(() => ({
    undoStack: [] as Entry[],
    redoStack: [] as Entry[],
    activeContextKey: '__root__',
    clearHistory: () => useTimelineCommandStore.setState({ undoStack: [], redoStack: [] }),
  }))
  return {
    useTimelineSettingsStore,
    useTimelineCommandStore,
    useCompositionNavigationStore: { getState: () => ({ breadcrumbs: [] }) },
    getActiveTabId: () => null,
  }
})
vi.mock('./embedded-workspace', () => ({ ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}) }))
vi.mock('./studio-export-bridge', () => ({ collectProjectJson: vi.fn(async () => null) }))
vi.mock('./edit-readiness', () => ({ waitUntilEditable: vi.fn(async () => 'p1') }))
vi.mock('./timeline-report', () => ({ readTimeline: () => ({}) }))

import { useProjectStore } from '../deps/projects-contract'
import { mediaLibraryService, useMediaLibraryStore } from '../deps/media-library-contract'
import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { updateProject } from '@/infrastructure/storage'
import { useEmbeddedStore } from '../stores/embedded-store'
import { currentRevision, handleGetProject, startProjectChangeAnnouncements } from './cloud-project'
import { handleOpenProject, setOpenProjectEditor } from './cloud-project-open'
import { claimImportedRef, mediaIdForRef, refsByMediaId } from './imported-refs'

type Item = Record<string, unknown> & { id: string }
type Timeline = {
  items: Item[]
  compositions?: Array<{ id: string; items: Item[]; tracks?: unknown[] }>
}

const ORIGIN = 'http://localhost:5173'
type Posted = { type: string; payload: Record<string, unknown> }
let post: { mock: { calls: unknown[][] }; mockRestore: () => void }
let stop: () => void = () => {}
const posted = (type: string) =>
  post.mock.calls.map((call) => call[0] as Posted).filter((m) => m.type === type)

const settings = useTimelineSettingsStore as unknown as {
  setState: (s: { isDirty?: boolean; isTimelineLoading?: boolean }) => void
  getState: () => { isDirty: boolean }
}
const history = useTimelineCommandStore as unknown as {
  setState: (s: { undoStack?: unknown[]; redoStack?: unknown[] }) => void
  getState: () => { undoStack: unknown[]; redoStack: unknown[] }
}
const library = useMediaLibraryStore as unknown as {
  setState: (s: { currentProjectId: string | null }) => void
}

// The editor mounting the project: it reads it from storage, loads its
// timeline (which marks the timeline dirty along the way) and settles.
const openEditor = vi.fn((projectId: string) => {
  setTimeout(() => {
    settings.setState({ isTimelineLoading: true, isDirty: true })
    library.setState({ currentProjectId: projectId })
    useProjectStore.setState({ currentProject: db.get(projectId) as never })
    setTimeout(() => settings.setState({ isTimelineLoading: false }), 20)
  }, 20)
})

const media = (id: string, ref = `ref-${id}`) => ({
  mediaId: id,
  ref,
  url: `https://cdn.example/${id}.mp4`,
  name: `${id}.mp4`,
  type: 'video/mp4',
})

function savedProject(timeline: Partial<Timeline> & Record<string, unknown>, extra = {}) {
  return {
    version: '1.0',
    exportedAt: '2026-11-24T00:00:00.000Z',
    editorVersion: '1.0.0',
    mediaReferences: [],
    project: {
      id: 'saved-project',
      name: 'My cut',
      description: '',
      createdAt: 0,
      updatedAt: 0,
      duration: 300,
      schemaVersion: 15,
      thumbnailId: 'thumb-on-another-device',
      metadata: { width: 1080, height: 1920, fps: 25, backgroundColor: '#112233' },
      timeline: { tracks: [{ id: 't1' }], items: [], ...timeline },
      ...extra,
    },
  }
}

const open = (payload: Record<string, unknown>, origin = ORIGIN) =>
  handleOpenProject(
    new MessageEvent('message', { data: { type: 'NODARO_OPEN_PROJECT', payload }, origin }),
  )

const opened = () => posted('FREECUT_PROJECT_OPENED').at(-1)!.payload
const written = () => {
  const calls = vi.mocked(updateProject).mock.calls
  return calls.at(-1)![1] as Record<string, unknown> & { timeline: Timeline }
}
const okFetch = () =>
  vi.fn(async (url: string) => new Response(new Blob([url], { type: 'video/mp4' })))

beforeEach(() => {
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  useEmbeddedStore.setState({
    isEmbedded: true,
    parentOrigin: ORIGIN,
    isImporting: false,
    pendingVideoImport: null,
  })
  settings.setState({ isDirty: false, isTimelineLoading: false })
  history.setState({ undoStack: [], redoStack: [] })
  useProjectStore.setState({ currentProject: { id: 'current' } as never })
  library.setState({ currentProjectId: 'current' })
  db.clear()
  vi.mocked(updateProject).mockClear()
  vi.mocked(useProjectStore.getState().createProject).mockClear()
  vi.mocked(mediaLibraryService.importMediaBlob).mockClear()
  openEditor.mockClear()
  setOpenProjectEditor(openEditor)
  vi.stubGlobal('fetch', okFetch())
})
afterEach(() => {
  stop()
  post.mockRestore()
  vi.unstubAllGlobals()
})

describe('NODARO_OPEN_PROJECT', () => {
  it('open restores a timeline with two media, each item pointing at its own imported media', async () => {
    const projectJson = savedProject({
      items: [
        { id: 'i1', mediaId: 'm1', src: 'blob:old', thumbnailUrl: 'blob:thumb' },
        { id: 'i2', mediaId: 'm2' },
        {
          id: 'c1',
          type: 'text',
          captionSource: { type: 'transcript', clipId: 'i1', mediaId: 'm1' },
        },
        { id: 'i3', type: 'text' },
      ],
      compositions: [{ id: 'seq1', items: [{ id: 'i4', mediaId: 'm2' }], tracks: [] }],
      topLevelSequenceIds: ['seq1'],
      markers: [{ id: 'k1', frame: 10, color: 'red' }],
      keyframes: [{ itemId: 'i1', properties: [] }],
    })

    await open({ requestId: 'o1', projectJson, media: [media('m1'), media('m2')] })

    expect(opened()).toEqual({ requestId: 'o1', ok: true, missing: [], revision: 0 })
    expect(post.mock.calls.at(-1)![1]).toBe(ORIGIN)
    const { timeline, metadata, name, thumbnailId, schemaVersion } = written()
    expect(timeline.items.map((item) => item.mediaId)).toEqual([
      'new-m1.mp4',
      'new-m2.mp4',
      undefined,
      undefined,
    ])
    expect(timeline.items[0]).toMatchObject({ src: undefined, thumbnailUrl: undefined })
    expect((timeline.items[2]!.captionSource as { mediaId: string }).mediaId).toBe('new-m1.mp4')
    expect(timeline.compositions![0]!.items[0]!.mediaId).toBe('new-m2.mp4')
    // Everything else the file carries comes back: settings, markers, sequences, keyframes.
    expect(metadata).toEqual({ width: 1080, height: 1920, fps: 25, backgroundColor: '#112233' })
    expect(name).toBe('My cut')
    expect(schemaVersion).toBe(15)
    expect(thumbnailId).toBeUndefined()
    expect(timeline).toMatchObject({
      topLevelSequenceIds: ['seq1'],
      markers: [{ id: 'k1', frame: 10, color: 'red' }],
      keyframes: [{ itemId: 'i1', properties: [] }],
    })
    // The fresh project is the one the editor opens, and the store holds the restored one.
    const freshId = vi.mocked(updateProject).mock.calls.at(-1)![0]
    expect(openEditor).toHaveBeenCalledWith(freshId)
    expect(useProjectStore.getState().currentProject?.id).toBe(freshId)
    expect(refsByMediaId()).toEqual({ 'new-m1.mp4': 'ref-m1', 'new-m2.mp4': 'ref-m2' })
    // Fetched by the editor itself, without credentials.
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('https://cdn.example/m1.mp4', {
      credentials: 'omit',
    })
  })

  it('open reports a media whose fetch fails in missing and still restores the timeline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('m2') ? new Response('nope', { status: 404 }) : new Response(new Blob(['x'])),
      ),
    )
    const projectJson = savedProject({
      items: [
        { id: 'i1', mediaId: 'm1' },
        { id: 'i2', mediaId: 'm2' },
      ],
    })

    await open({ requestId: 'o2', projectJson, media: [media('m1'), media('m2')] })

    expect(opened()).toEqual({ requestId: 'o2', ok: true, missing: ['m2'], revision: 0 })
    expect(written().timeline.items.map((item) => item.mediaId)).toEqual(['new-m1.mp4', 'm2'])
    expect(refsByMediaId()).toEqual({ 'new-m1.mp4': 'ref-m1' })
  })

  it('a network error or an import failure is missing too, and a saved id with no media entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('m1')) throw new TypeError('Failed to fetch')
        return new Response(new Blob(['x']))
      }),
    )
    vi.mocked(mediaLibraryService.importMediaBlob).mockImplementationOnce(async () => {
      throw new Error('cannot decode')
    })
    const projectJson = savedProject({
      items: [
        { id: 'i1', mediaId: 'm1' },
        { id: 'i2', mediaId: 'm2' },
        { id: 'i3', mediaId: 'm3' },
        { id: 'i9', mediaId: 'm9' },
      ],
    })

    await open({ requestId: 'o3', projectJson, media: [media('m1'), media('m2'), media('m3')] })

    expect(opened()).toMatchObject({ ok: true, missing: ['m1', 'm2', 'm9'] })
    expect(written().timeline.items.map((item) => item.mediaId)).toEqual([
      'm1',
      'm2',
      'new-m3.mp4',
      'm9',
    ])
  })

  it('fetches four media at a time', async () => {
    let running = 0
    let most = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        running += 1
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running -= 1
        return new Response(new Blob(['x']))
      }),
    )
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

    await open({
      requestId: 'o4',
      projectJson: savedProject({}),
      media: ids.map((id) => media(id)),
    })

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(7)
    expect(most).toBe(4)
  })

  it('open migrates an older schema', async () => {
    const projectJson = savedProject(
      {
        items: [{ id: 'i1', mediaId: 'm1' }],
        keyframes: [{ itemId: 'i1', properties: [] }],
        compositions: [{ id: 'seq1', items: [], tracks: [] }],
      },
      { schemaVersion: 14 },
    )

    await open({ requestId: 'o5', projectJson, media: [media('m1')] })

    expect(opened()).toMatchObject({ ok: true })
    const project = written() as Record<string, unknown> & {
      timeline: Timeline & { keyframes: Array<{ animationVersion?: number }> }
    }
    expect(project.schemaVersion).toBe(15)
    expect(project.timeline.keyframes[0]!.animationVersion).toBe(2)
    expect(project.timeline.items[0]!.mediaId).toBe('new-m1.mp4')
  })

  it('open with no project in projectJson answers ok: false and leaves the current project untouched', async () => {
    for (const projectJson of [{}, null, 'not json', '{"version":"1.0"}']) {
      await open({ requestId: 'o6', projectJson, media: [media('m1')] })
      expect(opened()).toEqual({
        requestId: 'o6',
        ok: false,
        missing: [],
        revision: currentRevision(),
      })
    }

    expect(vi.mocked(useProjectStore.getState().createProject)).not.toHaveBeenCalled()
    expect(updateProject).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(openEditor).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject?.id).toBe('current')
  })

  it('open does not announce a change, and starts the history and the revision afresh', async () => {
    stop = startProjectChangeAnnouncements()
    // A change made before the parent set its origin is waiting to be told...
    useEmbeddedStore.setState({ parentOrigin: null })
    settings.setState({ isDirty: true })
    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(0)

    // ...and the open (which sets the origin, and whose load marks the timeline dirty) replaces it.
    await open({
      requestId: 'o7',
      projectJson: savedProject({ items: [{ id: 'i1', mediaId: 'm1' }] }),
      media: [media('m1')],
    })
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(opened()).toMatchObject({ ok: true, revision: 0 })
    expect(posted('FREECUT_PROJECT_CHANGED')).toHaveLength(0)
    expect(currentRevision()).toBe(0)
    expect(useEmbeddedStore.getState().parentOrigin).toBe(ORIGIN)
    expect(history.getState()).toMatchObject({ undoStack: [], redoStack: [] })
    expect(settings.getState().isDirty).toBe(false)

    // A change after the open is announced, from revision 1.
    settings.setState({ isDirty: false })
    settings.setState({ isDirty: true })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(posted('FREECUT_PROJECT_CHANGED').map((m) => m.payload.revision)).toEqual([1])
  })

  it('open names only the media of the project it opened in the refs', async () => {
    claimImportedRef('ref-old')('media-of-the-old-project')
    // An import of the old project still running when the open starts.
    const settleLate = claimImportedRef('ref-late')

    await open({
      requestId: 'o8',
      projectJson: savedProject({ items: [{ id: 'i1', mediaId: 'm1' }] }),
      media: [media('m1')],
    })
    settleLate('late-media-of-the-old-project')

    expect(refsByMediaId()).toEqual({ 'new-m1.mp4': 'ref-m1' })
    expect(await mediaIdForRef('ref-old', 10)).toBeNull()
    expect(await mediaIdForRef('ref-late', 10)).toBeNull()
    expect(await mediaIdForRef('ref-m1', 10)).toBe('new-m1.mp4')
  })

  it('two media sharing one ref both map to it', async () => {
    const projectJson = savedProject({
      items: [
        { id: 'i1', mediaId: 'm1' },
        { id: 'i2', mediaId: 'm2' },
      ],
    })

    await open({ requestId: 'o9', projectJson, media: [media('m1', 'same'), media('m2', 'same')] })

    expect(refsByMediaId()).toEqual({ 'new-m1.mp4': 'same', 'new-m2.mp4': 'same' })
  })

  it('leaves no pending video import to be placed on the opened project', async () => {
    useEmbeddedStore.setState({ pendingVideoImport: { mediaId: 'stale' } })

    await open({ requestId: 'o10', projectJson: savedProject({}), media: [] })

    expect(useEmbeddedStore.getState().pendingVideoImport).toBeNull()
    expect(useEmbeddedStore.getState().isImporting).toBe(false)
  })

  it('points the captions and subtitles of an item at the imported media too', async () => {
    const projectJson = savedProject({
      items: [
        {
          id: 'i1',
          mediaId: 'm1',
          transcriptCaptions: { type: 'transcript', mediaId: 'm1', enabled: true, updatedAt: 1 },
        },
        { id: 's1', type: 'subtitle', source: { type: 'transcript', mediaId: 'm2', clipId: 'i1' } },
        { id: 's2', type: 'subtitle', source: { type: 'subtitle-import', fileName: 'a.srt' } },
      ],
    })

    await open({ requestId: 'o11', projectJson, media: [media('m1')] })

    const [video, subtitle, imported] = written().timeline.items
    expect(video!.transcriptCaptions).toMatchObject({ mediaId: 'new-m1.mp4', enabled: true })
    expect(subtitle!.source).toEqual({ type: 'transcript', mediaId: 'm2', clipId: 'i1' })
    expect(imported!.source).toEqual({ type: 'subtitle-import', fileName: 'a.srt' })
    expect(opened()).toMatchObject({ ok: true, missing: ['m2'] })
  })

  it('a request sent during the open runs once the open has answered', async () => {
    const opening = open({
      requestId: 'o12',
      projectJson: savedProject({ items: [{ id: 'i1', mediaId: 'm1' }] }),
      media: [media('m1')],
    })
    const get = handleGetProject(
      new MessageEvent('message', {
        data: { type: 'NODARO_GET_PROJECT', payload: { requestId: 'g1' } },
        origin: ORIGIN,
      }),
    )
    await Promise.all([opening, get])

    const order = post.mock.calls.map((call) => (call[0] as Posted).type)
    expect(order.indexOf('FREECUT_PROJECT_OPENED')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('FREECUT_PROJECT_OPENED')).toBeLessThan(order.indexOf('FREECUT_PROJECT'))
    expect(posted('FREECUT_PROJECT')[0]!.payload).toMatchObject({ requestId: 'g1', revision: 0 })
  })

  it('answers the origin that asked, and makes it the parent told about changes', async () => {
    const studio = 'https://studio.nodaro.ai'

    await open({ requestId: 'o13', projectJson: {}, media: [] }, studio)
    expect(post.mock.calls.at(-1)![1]).toBe(studio)
    expect(useEmbeddedStore.getState().parentOrigin).toBe(ORIGIN)

    await open({ requestId: 'o14', projectJson: savedProject({}), media: [] }, studio)
    expect(opened()).toMatchObject({ requestId: 'o14', ok: true })
    expect(post.mock.calls.at(-1)![1]).toBe(studio)
    expect(useEmbeddedStore.getState().parentOrigin).toBe(studio)
  })

  it('waits for a video import that is still running, then opens', async () => {
    useEmbeddedStore.setState({ isImporting: true })
    setTimeout(() => useEmbeddedStore.setState({ isImporting: false }), 100)

    await open({ requestId: 'o15', projectJson: savedProject({}), media: [] })

    expect(opened()).toMatchObject({ requestId: 'o15', ok: true })
    expect(openEditor).toHaveBeenCalledTimes(1)
  })

  it('a project without a canvas size answers ok: false and leaves the current project untouched', async () => {
    const projectJson = savedProject({})
    const { metadata: _metadata, ...withoutSize } = projectJson.project

    await open({
      requestId: 'o16',
      projectJson: { ...projectJson, project: withoutSize },
      media: [],
    })

    expect(opened()).toMatchObject({ requestId: 'o16', ok: false })
    expect(useProjectStore.getState().createProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject?.id).toBe('current')
  })

  it('an open that fails before replacing the project keeps its refs, revision and changes', async () => {
    stop = startProjectChangeAnnouncements()
    settings.setState({ isDirty: true })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const before = currentRevision()
    claimImportedRef('ref-kept')('media-kept')
    vi.mocked(useProjectStore.getState().createProject).mockRejectedValueOnce(
      new Error('disk full'),
    )
    history.setState({ undoStack: [{ command: { type: 'MOVE_ITEM' } }] })

    await open({ requestId: 'o17', projectJson: savedProject({}), media: [] })
    await new Promise((resolve) => setTimeout(resolve, 600))

    expect(opened()).toEqual({ requestId: 'o17', ok: false, missing: [], revision: before })
    expect(refsByMediaId()).toEqual({ 'media-kept': 'ref-kept' })
    expect(openEditor).not.toHaveBeenCalled()
    // The edit made while the open ran is still told.
    expect(currentRevision()).toBe(before + 1)
  })
})
