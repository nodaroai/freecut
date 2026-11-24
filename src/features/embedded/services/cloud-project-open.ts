import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  updateProject as updateProjectDB,
  getProject as getProjectDB,
} from '@/infrastructure/storage'
import type { Project, ProjectTimeline } from '@/types/project'
import { useProjectStore } from '../deps/projects-contract'
import { mediaLibraryService, useMediaLibraryStore } from '../deps/media-library-contract'
import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { beginProjectOpen, currentRevision } from './cloud-project'
import { enqueueRequest } from './edit-ops-bridge'
import { ensureEmbeddedWorkspaceMounted } from './embedded-workspace'
import { claimImportedRef, clearImportedRefs } from './imported-refs'

const log = createLogger('embedded-cloud-project-open')

const PROJECT_OPENED = 'FREECUT_PROJECT_OPENED'

/** How many media the editor fetches at once. */
const FETCH_CONCURRENCY = 4
/** How long an open waits for the editor to show the opened project, or for a video import to end. */
const WAIT_MS = 30_000
const POLL_MS = 50

/** One media item of the saved project, and where the editor fetches it. */
interface OpenMedia {
  readonly mediaId: string
  readonly ref: string
  readonly url: string
  readonly name: string
  readonly type: string
}

type OpenEditor = (projectId: string) => void

let openEditor: OpenEditor = (projectId) => {
  log.error('Cannot open the editor: no openEditor was set', { projectId })
}

/** How to show a project in the editor; the message handler passes the app shell's in. */
export function setOpenProjectEditor(open: OpenEditor): void {
  openEditor = open
}

/** The saved project in `projectJson`, brought to the current schema; null when there is none. */
function readSavedProject(projectJson: unknown): Project | null {
  try {
    const parsed: unknown = typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson
    const project = (parsed as { project?: unknown } | null)?.project
    if (!project || typeof project !== 'object') return null
    const { metadata } = project as Partial<Project>
    const sized =
      !!metadata &&
      [metadata.width, metadata.height, metadata.fps].every((n) => typeof n === 'number' && n > 0)
    if (!sized) return null
    return migrateProject(project as Project).project
  } catch (e) {
    log.warn('NODARO_OPEN_PROJECT: the project file cannot be read', { error: e })
    return null
  }
}

function readMedia(media: unknown): OpenMedia[] {
  if (!Array.isArray(media)) return []
  return media.filter(
    (entry): entry is OpenMedia =>
      !!entry &&
      typeof entry.mediaId === 'string' &&
      typeof entry.url === 'string' &&
      typeof entry.name === 'string',
  )
}

/** Runs `run` on every entry, at most `limit` at a time. */
async function eachLimited<T>(
  entries: readonly T[],
  limit: number,
  run: (entry: T) => Promise<void>,
) {
  let next = 0
  const worker = async () => {
    while (next < entries.length) await run(entries[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker))
}

/**
 * Fetches and imports each media item into the project, claiming its ref first
 * (once per entry: two items may share a ref). Answers the new media id of each
 * saved one that arrived; one that did not is left out.
 */
async function importMedia(media: readonly OpenMedia[], projectId: string) {
  const imported = new Map<string, string>()
  const settlers = media.map((entry) =>
    typeof entry.ref === 'string' && entry.ref ? claimImportedRef(entry.ref) : () => {},
  )
  try {
    await eachLimited(
      media.map((entry, index) => ({ entry, settle: settlers[index]! })),
      FETCH_CONCURRENCY,
      async ({ entry, settle }) => {
        try {
          const response = await fetch(entry.url, { credentials: 'omit' })
          if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
          const fetched = await response.blob()
          const blob = new Blob([fetched], { type: entry.type || fetched.type })
          const { id } = await mediaLibraryService.importMediaBlob(blob, projectId, entry.name)
          imported.set(entry.mediaId, id)
          settle(id)
        } catch (e) {
          log.warn(`NODARO_OPEN_PROJECT: could not bring in ${entry.name}`, { error: e })
          settle(null)
        }
      },
    )
  } finally {
    settlers.forEach((settle) => settle(null))
  }
  return imported
}

type TimelineItem = ProjectTimeline['items'][number]

/** The item fields holding an object that names a media id. */
const MEDIA_SOURCE_FIELDS = ['captionSource', 'transcriptCaptions', 'source'] as const

/**
 * Points each item at its imported media. An item whose media did not arrive
 * keeps its saved id, and that id is added to `missing`.
 */
function remapItems(
  items: readonly TimelineItem[] | undefined,
  imported: ReadonlyMap<string, string>,
  missing: Set<string>,
): TimelineItem[] {
  return (items ?? []).map((item) => {
    let next: Record<string, unknown> = item
    if (item.mediaId) {
      const mediaId = imported.get(item.mediaId)
      if (mediaId) next = { ...next, mediaId, src: undefined, thumbnailUrl: undefined }
      else missing.add(item.mediaId)
    }
    // What else on an item names its media: the clip captions came from, the
    // transcript captions follow, the media a subtitle segment was read from.
    for (const field of MEDIA_SOURCE_FIELDS) {
      const source = next[field] as { mediaId?: unknown } | undefined
      if (typeof source?.mediaId !== 'string' || !source.mediaId) continue
      const mediaId = imported.get(source.mediaId)
      if (mediaId) next = { ...next, [field]: { ...source, mediaId } }
      else missing.add(source.mediaId)
    }
    return next as TimelineItem
  })
}

function remapTimeline(
  timeline: ProjectTimeline,
  imported: ReadonlyMap<string, string>,
  missing: Set<string>,
): ProjectTimeline {
  return {
    ...timeline,
    items: remapItems(timeline.items, imported, missing),
    ...(timeline.compositions && {
      compositions: timeline.compositions.map((composition) => ({
        ...composition,
        items: remapItems(composition.items, imported, missing),
      })),
    }),
  }
}

/** Waits until `done` holds; false when it still does not after a while. */
async function waitFor(done: () => boolean): Promise<boolean> {
  const end = Date.now() + WAIT_MS
  for (;;) {
    if (done()) return true
    if (Date.now() >= end) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** The editor shows the project, with its timeline loaded. */
const editorShows = (projectId: string) => () =>
  useMediaLibraryStore.getState().currentProjectId === projectId &&
  useProjectStore.getState().currentProject?.id === projectId &&
  !useTimelineSettingsStore.getState().isTimelineLoading

function createFreshProject(saved: Project) {
  return useProjectStore.getState().createProject({
    name: saved.name || 'NodaroCut Edit',
    width: saved.metadata.width,
    height: saved.metadata.height,
    fps: saved.metadata.fps,
    backgroundColor: saved.metadata.backgroundColor ?? '#000000',
  })
}

/** Fills the fresh project with the saved one, and opens it in the editor. Answers `missing`. */
async function fillProject(
  project: Project,
  saved: Project,
  media: readonly OpenMedia[],
): Promise<string[]> {
  const imported = await importMedia(media, project.id)
  // The saved media first, in the order given; then ids the project names with no entry at all.
  const missing = new Set(media.map((entry) => entry.mediaId).filter((id) => !imported.has(id)))
  const timeline = saved.timeline && remapTimeline(saved.timeline, imported, missing)

  // The saved project's content in the fresh project: its id and creation stay
  // the fresh one's; a thumbnail or folder of another device does not come along.
  const {
    id: _id,
    createdAt: _createdAt,
    thumbnailId: _thumbnailId,
    thumbnail: _thumbnail,
    rootFolderHandle: _rootFolderHandle,
    rootFolderName: _rootFolderName,
    ...content
  } = saved
  await updateProjectDB(project.id, { ...content, timeline, updatedAt: Date.now() })
  const restored = await getProjectDB(project.id)
  if (restored) {
    useProjectStore.setState({
      currentProject: restored,
      projects: useProjectStore
        .getState()
        .projects.map((p) => (p.id === project.id ? restored : p)),
    })
  }

  openEditor(project.id)
  if (!(await waitFor(editorShows(project.id)))) {
    throw new Error('The editor did not open the project')
  }
  // The editor's load already starts the history afresh and leaves the timeline
  // clean; the open makes sure of it.
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.getState().markClean()
  return [...missing]
}

/**
 * NODARO_OPEN_PROJECT { requestId, projectJson, media } → FREECUT_PROJECT_OPENED
 * { requestId, ok, missing, revision }. Replaces the open project with a fresh
 * one holding the saved project file; the editor fetches each media item from
 * its `url` (4 at a time, without credentials) and points the items at it.
 * `missing` names the media ids that did not arrive or have no entry: their
 * items keep the saved id. The opened project is revision 0, with an empty
 * history, and the open itself is not announced as a change. Queued with the
 * edit and read requests, so none runs against a half-opened project. A file
 * with no project answers `ok: false` and leaves the open project as it is. An
 * open sent while a video is being imported (NODARO_LOAD_VIDEO) waits for it.
 */
export function handleOpenProject(event: MessageEvent): Promise<void> {
  const { requestId, projectJson, media } = (event.data?.payload ?? {}) as {
    requestId?: unknown
    projectJson?: unknown
    media?: unknown
  }
  if (typeof requestId !== 'string') return Promise.resolve()
  const reply = (ok: boolean, missing: string[]) =>
    window.parent.postMessage(
      { type: PROJECT_OPENED, payload: { requestId, ok, missing, revision: currentRevision() } },
      event.origin,
    )

  return enqueueRequest(async () => {
    const saved = readSavedProject(projectJson)
    if (!saved) {
      reply(false, [])
      return
    }
    const store = useEmbeddedStore.getState()
    if (!(await waitFor(() => !useEmbeddedStore.getState().isImporting))) {
      log.warn('NODARO_OPEN_PROJECT refused: a video is still being imported')
      reply(false, [])
      return
    }

    store.setIsImporting(true)
    const endOpen = beginProjectOpen()
    let replaced = false
    let ok = false
    let missing: string[] = []
    try {
      await ensureEmbeddedWorkspaceMounted()
      const project = await createFreshProject(saved)
      replaced = true
      // The parent that opens a project is the one told about its changes; what
      // was waiting for the project it replaced is not for this one.
      store.setParentOrigin(event.origin)
      store.setPendingVideoImport(null)
      clearImportedRefs()
      missing = await fillProject(project, saved, readMedia(media))
      ok = true
    } catch (e) {
      log.error('NODARO_OPEN_PROJECT failed:', e)
    } finally {
      useEmbeddedStore.getState().setIsImporting(false)
      endOpen(replaced)
    }
    reply(ok, missing)
  })
}
