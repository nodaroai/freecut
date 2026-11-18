import {
  applyTrackSizePreset,
  commitTrackHeights,
  MIN_TRACK_HEIGHT,
  TRACK_SIZE_PRESET_HEIGHTS,
  useEditorStore,
  useItemsStore,
} from '../../deps/studio-contract'

/** Where the editor keeps the Track Size the person chose (a view setting, not project data). */
const TRACK_SIZE_KEY = 'editor:trackSizePreset'
/** Set once the studio picked the size itself, so its tight lanes apply only to its own choice. */
const STUDIO_LANES_KEY = 'nodaro:studioLanes'

type ReadStorage = Pick<Storage, 'getItem'>

function read(storage: ReadStorage | null, key: string): string | null | undefined {
  try {
    return storage?.getItem(key)
  } catch {
    return undefined
  }
}

/** Whether the person has ever picked a Track Size in this browser (unreadable storage: assume so). */
export function hasChosenTrackSize(storage: ReadStorage | null): boolean {
  const value = read(storage, TRACK_SIZE_KEY)
  return value !== null
}

/**
 * The lanes made as tight as the editor allows: every lane still at the
 * preset's height (one the person did not resize) goes down to `tight`.
 * Null when there is nothing to change.
 */
export function tightLanes<T extends { readonly id: string; readonly height: number }>(
  tracks: readonly T[],
  presetHeight: number,
  tight: number,
): T[] | null {
  if (!tracks.some((track) => track.height === presetHeight)) return null
  return tracks.map((track) =>
    track.height === presetHeight ? { ...track, height: tight } : track,
  )
}

function storageOrNull(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/**
 * The studio shows its lanes tight, so the whole edit fits under the monitors.
 * Only while the Track Size is the studio's own choice: a size the person picks
 * always wins. Returns the stop.
 */
export function keepLanesTight(): () => void {
  const storage = storageOrNull()
  if (!hasChosenTrackSize(storage)) {
    applyTrackSizePreset('compact')
    try {
      storage?.setItem(STUDIO_LANES_KEY, 'tight')
    } catch {
      /* the lanes stay compact */
    }
  }
  if (read(storage, STUDIO_LANES_KEY) !== 'tight') return () => {}

  const tighten = () => {
    if (useEditorStore.getState().trackSizePreset !== 'compact') return
    const next = tightLanes(
      useItemsStore.getState().tracks,
      TRACK_SIZE_PRESET_HEIGHTS.compact,
      MIN_TRACK_HEIGHT,
    )
    if (next) commitTrackHeights(next)
  }
  tighten()
  return useItemsStore.subscribe((state, prev) => {
    if (state.tracks !== prev.tracks) tighten()
  })
}
