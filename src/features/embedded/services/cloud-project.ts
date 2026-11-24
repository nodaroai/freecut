import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { isEmbedded, useEmbeddedStore } from '../stores/embedded-store'
import { enqueueRequest } from './edit-ops-bridge'
import { onHistoryFreeEdit } from './history-free-batch'
import { refsByMediaId } from './imported-refs'
import { collectProjectJson } from './studio-export-bridge'

const PROJECT_CHANGED = 'FREECUT_PROJECT_CHANGED'
const PROJECT = 'FREECUT_PROJECT'

/** Changes inside this window are announced together, once, at its end. */
const ANNOUNCE_INTERVAL_MS = 500

// The newest announced change this session; 0 until the first one.
let revision = 0
let announceTimer: ReturnType<typeof setTimeout> | undefined
// A change was made while there was no parent to tell: it is told once one is set.
let unannounced = false
let stopAnnouncements: (() => void) | null = null
// True while a project is being opened: nothing it changes is a change to announce.
let opening = false

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
  window.parent.postMessage({ type: PROJECT_CHANGED, payload: { revision } }, origin)
}

function projectChanged() {
  if (opening) return
  if (announceTimer === undefined) announceTimer = setTimeout(announce, ANNOUNCE_INTERVAL_MS)
}

/**
 * Holds the announcements while a project is opened (NODARO_OPEN_PROJECT), and
 * answers how to end the open: the opened project is revision 0, with nothing
 * waiting to be announced, neither from during the open nor from before it.
 */
export function beginProjectOpen(): () => void {
  opening = true
  clearTimeout(announceTimer)
  announceTimer = undefined
  return () => {
    opening = false
    clearTimeout(announceTimer)
    announceTimer = undefined
    unannounced = false
    revision = 0
  }
}

type CommandState = ReturnType<typeof useTimelineCommandStore.getState>

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
 * Tells the parent, in FREECUT_PROJECT_CHANGED { revision }, that the project
 * changed, so it knows to ask for the project file again. A change is the
 * timeline turning dirty, an edit, an undo or a redo (including one made while
 * the timeline is already dirty and one made once the history is full), and an
 * edit request applied without history. Changes made before the parent set its
 * origin are told once, when it does. Starting again while started does
 * nothing; the answer stops the announcements.
 */
export function startProjectChangeAnnouncements(): () => void {
  if (stopAnnouncements) return stopAnnouncements

  const unsubscribers = [
    useTimelineSettingsStore.subscribe((state, prev) => {
      if (state.isDirty && !prev.isDirty) projectChanged()
    }),
    useTimelineCommandStore.subscribe((state, prev) => {
      if (historyMoved(state, prev)) projectChanged()
    }),
    onHistoryFreeEdit(projectChanged),
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
 * projectJson, refs }: the project file, the revision it is current with, and
 * the parent's ref for each media id it imported. Queued behind any running
 * edit request, so it hands over what that request left.
 */
export function handleGetProject(event: MessageEvent): Promise<void> {
  const { requestId } = (event.data?.payload ?? {}) as { requestId?: unknown }
  if (typeof requestId !== 'string') return Promise.resolve()
  return enqueueRequest(async () => {
    const at = revision
    const projectJson = await collectProjectJson()
    window.parent.postMessage(
      { type: PROJECT, payload: { requestId, revision: at, projectJson, refs: refsByMediaId() } },
      event.origin,
    )
  })
}
