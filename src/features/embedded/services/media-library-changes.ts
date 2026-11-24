import { useMediaLibraryStore } from '../deps/media-library-contract'

type LibraryState = ReturnType<typeof useMediaLibraryStore.getState>
type Media = LibraryState['mediaItems'][number]

/**
 * What the project file says of each media item (its `mediaReferences`, see
 * `mediaToSnapshotReference` in project-bundle): a change to any of these is a
 * change to the project file.
 */
const REFERENCE_FIELDS = [
  'id',
  'fileName',
  'fileSize',
  'mimeType',
  'duration',
  'width',
  'height',
  'fps',
  'codec',
  'bitrate',
  'contentHash',
] as const satisfies ReadonlyArray<keyof Media>

function signature(items: readonly Media[]): string {
  return JSON.stringify(
    items
      .map((item) => REFERENCE_FIELDS.map((field) => item[field] ?? null))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
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
