/**
 * Each track is a lane of one kind of clip (titles, pictures, footage, sound),
 * as an editor with agents lays it out: the kind its clips are, most of them,
 * marked on the track's header and its row as `data-lane="<kind of clip>"`,
 * so the stylesheet can colour a whole lane and name it. It reads the timeline
 * the editor already draws and writes only that one attribute, so nothing
 * upstream changes; a track with no clips has no lane.
 */

const TIMELINE = '[data-timeline-scroll-container]'

/** The kind most of a row's clips are, or null for an empty row. */
export function laneOf(row: Element): string | null {
  const counts = new Map<string, number>()
  for (const item of row.querySelectorAll('[data-timeline-item][data-item-type]')) {
    const kind = item.getAttribute('data-item-type')!
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [kind, count] of counts) if (best === null || count > counts.get(best)!) best = kind
  return best
}

function mark(el: Element, lane: string | null) {
  if (lane === null) {
    if (el.hasAttribute('data-lane')) el.removeAttribute('data-lane')
  } else if (el.getAttribute('data-lane') !== lane) {
    el.setAttribute('data-lane', lane)
  }
}

/** Mark every track's row and header with its lane. */
export function paintLanes(root: ParentNode = document): void {
  const lanes = new Map<string, string | null>()
  for (const row of root.querySelectorAll(`${TIMELINE} [data-track-id]`)) {
    const id = row.getAttribute('data-track-id')!
    const lane = laneOf(row)
    lanes.set(id, lane)
    mark(row, lane)
  }
  for (const header of root.querySelectorAll('[data-track-kind][data-track-id]')) {
    const id = header.getAttribute('data-track-id')!
    if (lanes.has(id)) mark(header, lanes.get(id)!)
  }
}

/** Keep the lanes marked while the timeline changes; returns the stop. */
export function watchLanes(): () => void {
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      paintLanes()
    })
  }
  // Its own data-lane marks are not watched, so marking never repaints.
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-item-type', 'data-track-id'],
  })
  schedule()
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
