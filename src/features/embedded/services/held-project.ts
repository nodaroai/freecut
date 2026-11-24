import { useMediaLibraryStore } from '../deps/media-library-contract'
import { useProjectStore } from '../deps/projects-contract'
import { useTimelineSettingsStore } from '../deps/timeline-contract'
import { projectBlocker } from './edit-readiness'
import { projectLoadInProgress } from './project-load'

/** How long a read of the project file waits for the editor to show it. */
const SHOWN_WAIT_MS = 10_000
const POLL_MS = 50

/** The editor shows the project, with its timeline loaded. */
export const editorShows = (projectId: string) => () =>
  useMediaLibraryStore.getState().currentProjectId === projectId &&
  useProjectStore.getState().currentProject?.id === projectId &&
  !useTimelineSettingsStore.getState().isTimelineLoading

/**
 * The editor's own id of the project it holds: the open project, when the
 * editor is on it. Null when no project is open, or while the editor is
 * between projects (it has not yet reached the open one, or it is elsewhere).
 * Read when a message is sent, so a reply names what the editor holds then.
 */
export function heldProjectId(): string | null {
  const id = useProjectStore.getState().currentProject?.id ?? null
  return id !== null && useMediaLibraryStore.getState().currentProjectId === id ? id : null
}

/**
 * The open project's id when the editor shows it fully loaded and no
 * NODARO_LOAD_VIDEO or video import is running: the moment the live stores
 * hold exactly that project, so saving them saves it. Null otherwise.
 */
export function shownProjectId(): string | null {
  const id = useProjectStore.getState().currentProject?.id
  if (!id || projectBlocker() || projectLoadInProgress()) return null
  return editorShows(id)() ? id : null
}

/**
 * Waits (up to 10 s) until the editor shows the open project fully loaded;
 * answers its id, or null when it still does not, or at once when no project
 * is open.
 */
export async function waitUntilProjectShown(timeoutMs = SHOWN_WAIT_MS): Promise<string | null> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const id = shownProjectId()
    if (id) return id
    if (!useProjectStore.getState().currentProject?.id || Date.now() >= end) return null
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
