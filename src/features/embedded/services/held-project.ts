import { useMediaLibraryStore } from '../deps/media-library-contract'
import { useProjectStore } from '../deps/projects-contract'
import { useTimelineSettingsStore } from '../deps/timeline-contract'

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
