import { useItemsStore } from '../../deps/studio-contract'

/** The lanes of `next` that `prev` did not have, in their order. */
export function addedLanes(
  prev: ReadonlyArray<{ id: string }>,
  next: ReadonlyArray<{ id: string }>,
): string[] {
  const known = new Set(prev.map((track) => track.id))
  return next.filter((track) => !known.has(track.id)).map((track) => track.id)
}

/**
 * Bring a lane an agent adds into view (a new TITLES lane under the fold is
 * otherwise missed). Only lanes added after it starts; returns the stop.
 */
export function followNewLanes(): () => void {
  let frame = 0
  return useItemsStore.subscribe((state, prev) => {
    if (state.tracks === prev.tracks) return
    const added = addedLanes(prev.tracks, state.tracks)
    const last = added[added.length - 1]
    if (!last) return
    cancelAnimationFrame(frame)
    // After the timeline has drawn the lane.
    frame = requestAnimationFrame(() => {
      const header = document.querySelector(`[data-track-id="${CSS.escape(last)}"]`)
      header?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  })
}
