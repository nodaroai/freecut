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
/** Set while the Track Size is the studio's own choice; gone once the person picks one. */
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
 * The lanes made as tight as the editor allows: each lane not yet `seen`
 * that is still at the preset's height goes down to `tight`. A lane seen
 * before is left as it is, so a height the person gives it stays. Null when
 * there is nothing to change.
 */
export function tightLanes<T extends { readonly id: string; readonly height: number }>(
  tracks: readonly T[],
  seen: ReadonlySet<string>,
  presetHeight: number,
  tight: number,
): T[] | null {
  const loose = (track: T) => !seen.has(track.id) && track.height === presetHeight
  if (!tracks.some(loose)) return null
  return tracks.map((track) => (loose(track) ? { ...track, height: tight } : track))
}

function storageOrNull(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

function forget(storage: Storage | null) {
  try {
    storage?.removeItem(STUDIO_LANES_KEY)
  } catch {
    /* nothing to forget */
  }
}

/**
 * The studio shows its lanes tight, so the whole edit fits under the monitors:
 * each lane once, when it first shows. Only while the Track Size is the
 * studio's own choice: once the person picks a size, theirs wins for good.
 * Returns the stop.
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

  const seen = new Set<string>()
  let stopped = false
  const tighten = () => {
    if (stopped || useEditorStore.getState().trackSizePreset !== 'compact') return
    const tracks = useItemsStore.getState().tracks
    const next = tightLanes(tracks, seen, TRACK_SIZE_PRESET_HEIGHTS.compact, MIN_TRACK_HEIGHT)
    for (const track of tracks) seen.add(track.id)
    if (next) commitTrackHeights(next)
  }
  tighten()
  const stopTracks = useItemsStore.subscribe((state, prev) => {
    if (state.tracks !== prev.tracks) tighten()
  })
  // The person picked a Track Size of their own: leave every lane to it from now on.
  const stopPreset = useEditorStore.subscribe((state, prev) => {
    if (state.trackSizePreset === prev.trackSizePreset) return
    stopped = true
    forget(storage)
  })
  return () => {
    stopTracks()
    stopPreset()
  }
}
