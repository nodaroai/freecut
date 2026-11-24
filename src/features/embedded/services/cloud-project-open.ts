import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  updateProject as updateProjectDB,
  getProject as getProjectDB,
} from '@/infrastructure/storage'
import type { Project } from '@/types/project'
import { useProjectStore } from '../deps/projects-contract'
import { useMediaLibraryStore } from '../deps/media-library-contract'
import {
  loadTimeline,
  saveTimeline,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '../deps/timeline-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { beginProjectOpen, currentRevision } from './cloud-project'
import {
  importMedia,
  isStorageFull,
  readMedia,
  remapTimeline,
  type OpenMedia,
} from './cloud-project-media'
import { enqueueRequest } from './edit-ops-bridge'
import { ensureEmbeddedWorkspaceMounted } from './embedded-workspace'
import { editorShows, heldProjectId } from './held-project'
import { claimImportedRef, clearImportedRefs } from './imported-refs'

const log = createLogger('embedded-cloud-project-open')

const PROJECT_OPENED = 'FREECUT_PROJECT_OPENED'
const OPEN_PROGRESS = 'FREECUT_OPEN_PROGRESS'

/** How long an open waits for the editor to show a project, or for a video import to end. */
const WAIT_MS = 30_000
const POLL_MS = 50

type OpenEditor = (projectId: string) => void
/** Remembers where the app is, and answers how to go back there. */
export type SaveLocation = () => () => void

let openEditor: OpenEditor = (projectId) => {
  log.error('Cannot open the editor: no openEditor was set', { projectId })
}
let saveLocation: SaveLocation | null = null

/**
 * How to show a project in the editor, and how to come back to where the app
 * was when an open fails; the message handler passes the app shell's in.
 */
export function setOpenProjectEditor(open: OpenEditor, save: SaveLocation): void {
  openEditor = open
  saveLocation = save
}

// The newest open accepted and not yet answered.
let pendingOpen: Promise<void> | null = null

/** The parent cancelled the open (NODARO_CANCEL_OPEN). */
class OpenCancelled extends Error {
  constructor() {
    super('The open was cancelled')
  }
}

/** An open from the moment it is accepted until it is answered: what a cancel reaches. */
interface RunningOpen {
  readonly origin: string
  readonly controller: AbortController
  /** Set once the opened project is the open one: a cancel then does nothing. */
  committed: boolean
}
const runningOpens = new Map<string, RunningOpen>()

/**
 * NODARO_CANCEL_OPEN { requestId }: stops the open with that requestId, sent
 * from the same origin, and rolls it back as a failed open; it then answers
 * `ok: false, cancelled: true`. Not queued: the open holds the request queue.
 * A cancel that arrives once the open has committed, or names no running
 * open, does nothing.
 */
export function handleCancelOpen(event: MessageEvent): void {
  const { requestId } = (event.data?.payload ?? {}) as { requestId?: unknown }
  const open = typeof requestId === 'string' ? runningOpens.get(requestId) : undefined
  if (!open || open.origin !== event.origin) return
  if (open.committed) {
    log.info('NODARO_CANCEL_OPEN ignored: the project is already open', { requestId })
    return
  }
  open.controller.abort(new OpenCancelled())
}

/** Settles once every open accepted so far has been answered; null when none is waiting. */
export function openInProgress(): Promise<void> | null {
  return pendingOpen
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

/**
 * Waits until `done` holds; false when it still does not after a while.
 * Throws the signal's reason as soon as it aborts.
 */
async function waitFor(done: () => boolean, signal?: AbortSignal): Promise<boolean> {
  const end = Date.now() + WAIT_MS
  for (;;) {
    signal?.throwIfAborted()
    if (done()) return true
    if (Date.now() >= end) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** What was open when an open began: what a failed open puts back. */
interface Before {
  readonly project: Project | null
  /** The project the editor showed (its media library's project), if any. */
  readonly shownId: string | null
  readonly pendingVideoImport: { mediaId: string } | null
  /** Goes back to where the app was; null when the app shell cannot say. */
  readonly goBack: (() => void) | null
}

/** Makes the fresh project, without showing it: the project that is open stays the open one. */
async function createFresh(saved: Project, before: Before): Promise<Project> {
  const project = await useProjectStore.getState().createProject({
    name: saved.name || 'NodaroCut Edit',
    width: saved.metadata.width,
    height: saved.metadata.height,
    fps: saved.metadata.fps,
    backgroundColor: saved.metadata.backgroundColor ?? '#000000',
  })
  // Making it sets it as the current project; it becomes that only when shown.
  useProjectStore.setState({ currentProject: before.project })
  return project
}

/**
 * Fills the fresh project with the saved one and its media. Answers the stored
 * project, the media ids that did not arrive, and the refs of the media that did.
 */
async function fillFresh(
  projectId: string,
  saved: Project,
  media: readonly OpenMedia[],
  control: OpenControl,
) {
  let fetched = 0
  const { imported, refs } = await importMedia(media, projectId, {
    signal: control.signal,
    onSettled: () => control.progress((fetched += 1)),
  })
  control.signal.throwIfAborted()
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
  await updateProjectDB(projectId, { ...content, timeline, updatedAt: Date.now() })
  const restored = await getProjectDB(projectId)
  if (!restored) throw new Error('The opened project was not stored')
  return { project: restored, missing, refs }
}

/** Shows the fresh project in the editor, keeping what the open project had unsaved. */
async function showProject(project: Project, before: Before, signal: AbortSignal): Promise<void> {
  const shown = before.project && editorShows(before.project.id)()
  if (before.project && shown) await saveTimeline(before.project.id)
  signal.throwIfAborted()
  useEmbeddedStore.getState().setPendingVideoImport(null)
  useProjectStore.setState({
    currentProject: project,
    projects: useProjectStore.getState().projects.map((p) => (p.id === project.id ? project : p)),
  })
  openEditor(project.id)
  const mounted = () => useMediaLibraryStore.getState().currentProjectId === project.id
  if (!(await waitFor(mounted, signal))) throw new Error('The editor did not open the project')
  // The editor's own load of the project (joined while it runs): it fails
  // quietly in the editor, and a failed load is a failed open.
  await loadTimeline(project.id)
  if (!(await waitFor(editorShows(project.id), signal))) {
    throw new Error('The editor did not open the project')
  }
}

/** Sends the app back to where it was before the open, and waits for the editor to settle there. */
async function goBack(before: Before, freshId: string | null) {
  const moved = useMediaLibraryStore.getState().currentProjectId !== before.shownId
  // Going back also cancels a navigation to the fresh project not yet taken.
  if (before.goBack) before.goBack()
  else if (before.project) openEditor(before.project.id)
  if (!moved) {
    // The editor never left: a same-place navigation does not reload it.
    useProjectStore.setState({ currentProject: before.project })
    return
  }
  const settled = before.project
    ? editorShows(before.project.id)
    : () => useMediaLibraryStore.getState().currentProjectId !== freshId
  if (!(await waitFor(settled))) {
    log.error('NODARO_OPEN_PROJECT: the editor did not go back to where it was')
  }
}

/**
 * Puts back what was open before a failed open: the editor shows the previous
 * project again, or no project when none was open (when it had moved), the
 * store holds it, and the fresh project and the media imported for it are removed.
 */
async function rollBack(before: Before, freshId: string | null, navigated: boolean) {
  if (navigated) await goBack(before, freshId)
  useEmbeddedStore.getState().setPendingVideoImport(before.pendingVideoImport)
  if (freshId) {
    const store = useProjectStore.getState()
    try {
      await store.deleteProject(freshId)
      await store.permanentlyDeleteProject(freshId)
    } catch (e) {
      log.warn('NODARO_OPEN_PROJECT: the fresh project could not be removed', { error: e })
    }
  }
  useProjectStore.setState({ currentProject: before.project })
}

/** The opened project is the open one: its refs replace the previous project's, and its history starts empty. */
function commitOpen(origin: string, refs: ReadonlyArray<{ ref: string; mediaId: string }>) {
  // The parent that opens a project is the one told about its changes.
  useEmbeddedStore.getState().setParentOrigin(origin)
  clearImportedRefs()
  refs.forEach(({ ref, mediaId }) => claimImportedRef(ref)(mediaId))
  // The editor's load already starts the history afresh and leaves the timeline
  // clean; the open makes sure of it.
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.getState().markClean()
}

/** What runs an open: its cancel signal, how it reports progress, and its commit. */
interface OpenControl {
  readonly signal: AbortSignal
  /** Tells the parent how many of the media files have settled. */
  readonly progress: (fetched: number) => void
  /** Marks the open committed: from then on a cancel does nothing. */
  readonly commit: () => void
}

/**
 * Removes the project open before a successful open, and the media only it
 * used (NODARO_OPEN_PROJECT `discardPrevious`): the parent has it saved. A
 * failure leaves it in local storage and does not change the open's answer.
 */
async function discardPrevious(projectId: string) {
  const store = useProjectStore.getState()
  try {
    await store.deleteProject(projectId)
    await store.permanentlyDeleteProject(projectId)
  } catch (e) {
    log.warn('NODARO_OPEN_PROJECT: the previous project could not be removed', { error: e })
  }
}

/** Opens the saved project; answers `missing`, or throws after putting back what was open. */
async function openProject(
  saved: Project,
  media: unknown,
  origin: string,
  control: OpenControl,
  discard: boolean,
): Promise<string[]> {
  const before: Before = {
    project: useProjectStore.getState().currentProject,
    shownId: useMediaLibraryStore.getState().currentProjectId,
    pendingVideoImport: useEmbeddedStore.getState().pendingVideoImport,
    goBack: saveLocation?.() ?? null,
  }
  const { entries, malformed } = readMedia(media)
  const { signal } = control
  control.progress(0)
  let freshId: string | null = null
  let navigated = false
  let missing: string[]
  try {
    await ensureEmbeddedWorkspaceMounted()
    signal.throwIfAborted()
    freshId = (await createFresh(saved, before)).id
    signal.throwIfAborted()
    const built = await fillFresh(freshId, saved, entries, control)
    navigated = true
    await showProject(built.project, before, signal)
    // No await from this check to the commit: a cancel either lands before it or does nothing.
    signal.throwIfAborted()
    control.commit()
    commitOpen(origin, built.refs)
    missing = [...new Set([...built.missing, ...malformed])]
  } catch (e) {
    await rollBack(before, freshId, navigated)
    throw e
  }
  if (discard && before.project && before.project.id !== freshId) {
    await discardPrevious(before.project.id)
  }
  return missing
}

/** What a failed open's answer adds: why it failed, when the parent can act on it. */
function failure(error: unknown): Record<string, unknown> {
  if (error instanceof OpenCancelled) return { cancelled: true }
  if (isStorageFull(error)) return { reason: 'storage' }
  return {}
}

/**
 * NODARO_OPEN_PROJECT { requestId, projectJson, media, discardPrevious? } →
 * FREECUT_PROJECT_OPENED { requestId, ok, missing, revision, projectId }.
 * Replaces the open project with a fresh one holding the saved project file;
 * the editor fetches each media item from its `url` (https only, 4 at a time,
 * without credentials) and points the items at it, telling the parent its
 * progress in FREECUT_OPEN_PROGRESS { requestId, fetched, total }. `missing`
 * names the media ids that did not arrive, are malformed or have no entry:
 * their items keep the saved id. The opened project is revision 0, with an
 * empty history, and the open itself is not announced as a change. Queued with
 * the edit and read requests, so none runs against a half-opened project; an
 * open sent while a video is being imported waits for it.
 * `ok: false` means the project open before is still open, with its content,
 * playhead and revision; a change waiting as the open began, or made while it
 * ran, is announced once afterwards (possibly when nothing changed). When the
 * editor had already moved to the opened project, it reloads the previous
 * one, which starts its undo history, open tab, selection, zoom and scroll
 * afresh. It carries `cancelled: true` after a NODARO_CANCEL_OPEN, and
 * `reason: 'storage'` when the media did not fit in the browser's storage.
 * With `discardPrevious: true`, a successful open then deletes the previous
 * project and the media only it used.
 */
export function handleOpenProject(event: MessageEvent): Promise<void> {
  const { requestId, projectJson, media, discardPrevious } = (event.data?.payload ?? {}) as {
    requestId?: unknown
    projectJson?: unknown
    media?: unknown
    discardPrevious?: unknown
  }
  if (typeof requestId !== 'string') return Promise.resolve()
  const post = (type: string, payload: Record<string, unknown>) =>
    window.parent.postMessage({ type, payload: { requestId, ...payload } }, event.origin)
  // Read when sent: the answer names what the editor holds then.
  const reply = (ok: boolean, missing: string[], why: Record<string, unknown> = {}) =>
    post(PROJECT_OPENED, {
      ok,
      missing,
      revision: currentRevision(),
      projectId: heldProjectId(),
      ...why,
    })

  // Known to a cancel from the moment it is accepted, while it waits its turn too.
  const running: RunningOpen = {
    origin: event.origin,
    controller: new AbortController(),
    committed: false,
  }
  runningOpens.set(requestId, running)
  const { signal } = running.controller

  const run = async () => {
    if (signal.aborted) return reply(false, [], failure(signal.reason))
    const saved = readSavedProject(projectJson)
    if (!saved) return reply(false, [])
    try {
      if (!(await waitFor(() => !useEmbeddedStore.getState().isImporting, signal))) {
        log.warn('NODARO_OPEN_PROJECT refused: a video is still being imported')
        return reply(false, [])
      }
    } catch (e) {
      return reply(false, [], failure(e))
    }

    const total = readMedia(media).entries.length
    const control: OpenControl = {
      signal,
      progress: (fetched) => post(OPEN_PROGRESS, { fetched, total }),
      commit: () => (running.committed = true),
    }
    useEmbeddedStore.getState().setIsImporting(true)
    const endOpen = beginProjectOpen()
    let ok = false
    let missing: string[] = []
    let why: Record<string, unknown> = {}
    try {
      missing = await openProject(saved, media, event.origin, control, discardPrevious === true)
      ok = true
    } catch (e) {
      log.error('NODARO_OPEN_PROJECT failed:', e)
      why = failure(e)
    } finally {
      useEmbeddedStore.getState().setIsImporting(false)
      endOpen(ok)
    }
    reply(ok, missing, why)
  }

  const done = enqueueRequest(async () => {
    try {
      await run()
    } finally {
      if (runningOpens.get(requestId) === running) runningOpens.delete(requestId)
    }
  })
  pendingOpen = done
  const settle = () => {
    if (pendingOpen === done) pendingOpen = null
  }
  done.then(settle, settle)
  return done
}
