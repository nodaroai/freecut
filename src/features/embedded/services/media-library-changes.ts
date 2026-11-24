import { useMediaLibraryStore } from '../deps/media-library-contract'
import { mediaToSnapshotReference } from '../deps/project-bundle-contract'

type LibraryState = ReturnType<typeof useMediaLibraryStore.getState>
type Media = LibraryState['mediaItems'][number]

/**
 * What the project file says of the media: its `mediaReferences`, each made by
 * `mediaToSnapshotReference`. A change to any of it is a change to the file.
 */
function signature(items: readonly Media[]): string {
  return JSON.stringify(
    items.map(mediaToSnapshotReference).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  )
}

/**
 * Calls `listener` whenever the open project's media library changes what the
 * project file lists: media added, removed, renamed or relinked, however that
 * happened. Loading a project's library (opening or switching projects) is
 * not a change: the first loaded list of each project is its starting point.
 */
export function onMediaLibraryChange(listener: () => void): () => void {
  let projectId: string | null = null
  let known: string | null = null
  return useMediaLibraryStore.subscribe((state) => {
    if (state.currentProjectId !== projectId) {
      projectId = state.currentProjectId
      known = null
    }
    if (!projectId || state.isLoading) return
    const now = signature(state.mediaItems)
    if (known !== null && now !== known) listener()
    known = now
  })
}
