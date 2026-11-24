import { useProjectStore } from '../deps/projects-contract'
import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { isEmbedded, useEmbeddedStore } from '../stores/embedded-store'
import { enqueueRequest } from './edit-ops-bridge'
import { heldProjectId } from './held-project'
import { onHistoryFreeEdit } from './history-free-batch'
import { refsByMediaId } from './imported-refs'
import { onMediaLibraryChange } from './media-library-changes'
import { readProjectFile } from './studio-export-bridge'

const PROJECT_CHANGED = 'FREECUT_PROJECT_CHANGED'
const PROJECT = 'FREECUT_PROJECT'

/** Changes inside this window are announced together, once, at its end. */
const ANNOUNCE_INTERVAL_MS = 500

// The newest announced change of the open project; 0 until its first one.
let revision = 0
// The open project the revision counts for (the project store's current one).
let revisionProjectId: string | null = null
let announceTimer: ReturnType<typeof setTimeout> | undefined
// A change was made while there was no parent to tell: it is told once one is set.
let unannounced = false
let stopAnnouncements: (() => void) | null = null
// True while a project is being opened: what changes meanwhile is told only if the open fails.
let opening = false
// A change was waiting when an open began, or was signalled while it ran.
let heldChange = false

/** The revision of the newest change announced to the parent. */
export function currentRevision(): number {
  return revision
}

/** The parent's origin, or null outside embedded mode or before the parent set one. */
function parentOrigin(): string | null {
  return isEmbedded() ? useEmbeddedStore.getState().parentOrigin : null
}

function announce() {
  announceTimer = undefined
  const origin = parentOrigin()
  if (!origin) {
    unannounced = true
    return
  }
  unannounced = false
  revision += 1
  window.parent.postMessage(
    { type: PROJECT_CHANGED, payload: { revision, projectId: revisionProjectId } },
    origin,
  )
}

/**
 * The open project is another one (a project opened or loaded, or the editor
 * sent elsewhere): a change of the project left is no longer told, and the
 * revision restarts at 0 for the new one.
 */
function projectSwitched(projectId: string | null) {
  clearTimeout(announceTimer)
  announceTimer = undefined
  unannounced = false
  revision = 0
  revisionProjectId = projectId
}

/** The open project, as the project store names it; null while none is. */
const openProjectId = () => useProjectStore.getState().currentProject?.id ?? null

function projectChanged() {
  if (opening) {
    heldChange = true
    return
  }
  if (announceTimer === undefined) announceTimer = setTimeout(announce, ANNOUNCE_INTERVAL_MS)
}

/**
 * Holds the announcements while a project is opened (NODARO_OPEN_PROJECT), and
 * answers how to end the open. Once the open project was replaced, the opened
 * one is revision 0, with nothing waiting to be announced, neither from during
 * the open nor from before it. A failed open leaves the revision as it was and
 * announces once when a change was waiting as it began or any change was
 * signalled while it ran (the person editing, or the editor reloading the
 * previous project): a change never goes untold, at the cost of an
 * announcement that may not change anything.
 */
export function beginProjectOpen(): (replaced: boolean) => void {
  opening = true
  heldChange = announceTimer !== undefined
  clearTimeout(announceTimer)
  announceTimer = undefined
  return (replaced) => {
    opening = false
    const held = heldChange
    heldChange = false
    if (!replaced) {
      if (held) projectChanged()
      return
    }
    projectSwitched(openProjectId())
  }
}

type CommandState = ReturnType<typeof useTimelineCommandStore.getState>
type OpenProject = NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']>

/**
 * What the project file carries of the project record itself. The file holds
 * the whole stored record (exportProjectJson), so this is every field but the
 * timeline, whose changes go through the command history, and the time it was
 * last written, which every save moves.
 */
function ownFields(project: OpenProject): string {
  const { timeline: _timeline, updatedAt: _updatedAt, ...own } = project
  return JSON.stringify(own)
}

/**
 * Calls `listener` when the open project's own fields change (a rename, a new
 * description or canvas), however that happened. Only writes made while the
 * editor is on the project count: the record a load or an open writes before
 * the editor reaches the project, and the skeleton the editor writes as it
 * mounts it, are its starting point.
 */
function onProjectRecordChange(listener: () => void): () => void {
  let known: { id: string; fields: string } | null = null
  return useProjectStore.subscribe((state) => {
    const project = state.currentProject
    if (!project || heldProjectId() !== project.id) {
      known = null
      return
    }
    const fields = ownFields(project)
    if (known?.id === project.id && known.fields !== fields) listener()
    known = { id: project.id, fields }
  })
}

/**
 * Whether a history update is an edit, an undo or a redo: a new top of either
 * stack. Switching timeline tabs swaps the stacks without changing the project,
 * and clearing the history (a project being loaded) leaves both stacks empty,
 * which no edit, undo or redo does.
 */
function historyMoved(state: CommandState, prev: CommandState): boolean {
  if (state.activeContextKey !== prev.activeContextKey) return false
  if (state.undoStack.length === 0 && state.redoStack.length === 0) return false
  return (
    state.undoStack.at(-1) !== prev.undoStack.at(-1) ||
    state.redoStack.at(-1) !== prev.redoStack.at(-1)
  )
}

/**
 * Tells the parent, in FREECUT_PROJECT_CHANGED { revision, projectId }, that
 * the project named changed, so it knows to ask for the project file again. A
 * change is the timeline turning dirty, an edit, an undo or a redo (including
 * one made while the timeline is already dirty and one made once the history
 * is full), an edit request applied without history, a change to the media
 * the project file lists (media imported, removed, renamed or relinked), and a
 * change to the project's own fields (a rename, say).
 * Changes made before the parent set its origin are told once, when it does.
 * When the open project changes, a change of the project left that is still
 * waiting is dropped and the revision restarts at 0.
 *
 * Starting again while started starts nothing new and answers the same stop
 * function as the first start; that function stops the announcements, and
 * calling it again does nothing.
 */
export function startProjectChangeAnnouncements(): () => void {
  if (stopAnnouncements) return stopAnnouncements

  revisionProjectId = openProjectId()
  const unsubscribers = [
    // A project switch. A moment with no project open (the editor remounting)
    // is not one, and an open settles the switch itself when it ends.
    useProjectStore.subscribe((state) => {
      const id = state.currentProject?.id ?? null
      if (id !== null && id !== revisionProjectId && !opening) projectSwitched(id)
    }),
    useTimelineSettingsStore.subscribe((state, prev) => {
      if (state.isDirty && !prev.isDirty) projectChanged()
    }),
    useTimelineCommandStore.subscribe((state, prev) => {
      if (historyMoved(state, prev)) projectChanged()
    }),
    onHistoryFreeEdit(projectChanged),
    onMediaLibraryChange(projectChanged),
    onProjectRecordChange(projectChanged),
    useEmbeddedStore.subscribe((state, prev) => {
      if (unannounced && state.parentOrigin && !prev.parentOrigin) projectChanged()
    }),
  ]

  const stop = () => {
    if (stopAnnouncements !== stop) return
    stopAnnouncements = null
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    clearTimeout(announceTimer)
    announceTimer = undefined
  }
  stopAnnouncements = stop
  return stop
}

/**
 * NODARO_GET_PROJECT { requestId } → FREECUT_PROJECT { requestId, revision,
 * projectId, projectJson, refs }: the project file, the revision it is current
 * with, the editor's id of the project, and the parent's ref for each media id
 * it imported. Queued behind any running edit request, so it hands over what
 * that request left. It answers once the editor shows the open project fully
 * loaded (waiting up to 10 s); otherwise it saves nothing and answers
 * `projectJson: null, notReady: true`.
 */
export function handleGetProject(event: MessageEvent): Promise<void> {
  const { requestId } = (event.data?.payload ?? {}) as { requestId?: unknown }
  if (typeof requestId !== 'string') return Promise.resolve()
  return enqueueRequest(async () => {
    // The revision the file is current with: the one when the live stores are saved.
    let at = revision
    const file = await readProjectFile(() => (at = revision))
    const payload = file
      ? { requestId, revision: at, ...file, refs: refsByMediaId() }
      : { requestId, revision, projectId: heldProjectId(), projectJson: null, notReady: true }
    window.parent.postMessage({ type: PROJECT, payload }, event.origin)
  })
}
