import { applyTrackSizePreset } from '../../deps/studio-contract'

/** Where the editor keeps the Track Size the person chose (a view setting, not project data). */
const TRACK_SIZE_KEY = 'editor:trackSizePreset'

/** Whether the person has ever picked a Track Size in this browser. */
export function hasChosenTrackSize(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(TRACK_SIZE_KEY) != null
  } catch {
    return true
  }
}

/**
 * The studio shows its lanes compact, so the whole edit fits under the monitors.
 * Only until the person picks a Track Size of their own: their choice always wins.
 */
export function settleCompactLanesOnce(): void {
  const storage = typeof localStorage === 'undefined' ? null : localStorage
  if (hasChosenTrackSize(storage)) return
  applyTrackSizePreset('compact')
}
