import { createLogger } from '@/shared/logging/logger'
import { useTimelineCommandStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { isEmbedded, useEmbeddedStore } from '../stores/embedded-store'
import { enqueueRequest } from './edit-ops-bridge'
import { refsByMediaId } from './imported-refs'
import { collectProjectJson } from './studio-export-bridge'

const log = createLogger('embedded-cloud-project')

const PROJECT_CHANGED = 'FREECUT_PROJECT_CHANGED'
const PROJECT = 'FREECUT_PROJECT'

/** Changes inside this window are announced together, once, at its end. */
const ANNOUNCE_INTERVAL_MS = 500

// The newest announced change this session; 0 until the first one.
let revision = 0
let announceTimer: ReturnType<typeof setTimeout> | undefined
let stopAnnouncements: (() => void) | null = null

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
  if (!origin) return
  revision += 1
  window.parent.postMessage({ type: PROJECT_CHANGED, payload: { revision } }, origin)
}

function projectChanged() {
  if (announceTimer === undefined) announceTimer = setTimeout(announce, ANNOUNCE_INTERVAL_MS)
}

/**
 * Tells the parent, in FREECUT_PROJECT_CHANGED { revision }, that the project
 * changed, so it knows to ask for the project file again. A change is the
 * timeline turning dirty, or a new top of the undo or redo history: a new
 * edit, an undo or a redo, including one made while the timeline is already
 * dirty and one made once the history is full (the oldest entry dropped, the
 * length unchanged). Switching timeline tabs swaps the history without
 * changing the project and is not a change. Starting again while started does
 * nothing; the answer stops the announcements.
 */
export function startProjectChangeAnnouncements(): () => void {
  if (stopAnnouncements) return stopAnnouncements

  const unsubscribeDirty = useTimelineSettingsStore.subscribe((state, prev) => {
    if (state.isDirty && !prev.isDirty) projectChanged()
  })
  const unsubscribeHistory = useTimelineCommandStore.subscribe((state, prev) => {
    if (state.activeContextKey !== prev.activeContextKey) return
    if (
      state.undoStack.at(-1) !== prev.undoStack.at(-1) ||
      state.redoStack.at(-1) !== prev.redoStack.at(-1)
    ) {
      projectChanged()
    }
  })

  const stop = () => {
    if (stopAnnouncements !== stop) return
    stopAnnouncements = null
    unsubscribeDirty()
    unsubscribeHistory()
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
    const origin = parentOrigin()
    if (!origin) {
      log.warn('NODARO_GET_PROJECT unanswered: no parent origin yet')
      return
    }
    window.parent.postMessage(
      { type: PROJECT, payload: { requestId, revision: at, projectJson, refs: refsByMediaId() } },
      origin,
    )
  })
}
