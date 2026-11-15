import { useItemsStore } from '../deps/timeline-contract'
import type { PresenceCursor, PresenceHighlight, PresencePlace } from '../stores/presence-store'
import { attr, boxOf, targetBox, targetPoint, type Box } from './presence-targets'

export interface Point {
  x: number
  y: number
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Where things are on screen right now. The timeline has no fixed frame-to-pixel
 * origin a feature can read, so it is measured from any item the timeline is
 * showing: its box and its `from` / `durationInFrames` give both the scale and
 * the origin, whatever the zoom and scroll.
 */
// The item the last frame measured the scale from, tried first: the scan over
// every item runs only when that one is gone or off screen.
let anchorItemId: string | null = null

export function measure() {
  const timeline = document.querySelector('[data-timeline-scroll-container]')
  const timelineBox = boxOf(timeline)
  const itemBox = (id: string) => boxOf(timeline?.querySelector(attr('data-item-id', id)))
  const trackBox = (id: string) => boxOf(timeline?.querySelector(attr('data-track-id', id)))

  const { items, itemById } = useItemsStore.getState()
  const scaleFrom = (item: (typeof items)[number] | undefined) => {
    if (!item || item.durationInFrames <= 0) return null
    const box = itemBox(item.id)
    if (!box) return null
    const perFrame = box.width / item.durationInFrames
    return { origin: box.left - item.from * perFrame, perFrame }
  }
  let scale = anchorItemId ? scaleFrom(itemById[anchorItemId]) : null
  if (!scale) {
    anchorItemId = null
    for (const item of items) {
      scale = scaleFrom(item)
      if (scale) {
        anchorItemId = item.id
        break
      }
    }
  }
  const frameX = (frame: number) => (scale ? scale.origin + frame * scale.perFrame : null)

  return {
    timelineBox,
    itemBox,
    trackBox,
    frameX,
    previewBox: boxOf(document.querySelector('[data-player-container]')),
  }
}

export type Measured = ReturnType<typeof measure>

/** A frame of the timeline, on a track when given (else just under the ruler). */
export function framePoint(frame: number, trackId: string | undefined, m: Measured): Point | null {
  const lane = m.timelineBox
  const x = m.frameX(frame)
  if (!lane || x === null) return null
  const track = trackId ? m.trackBox(trackId) : null
  return {
    x: clamp(x, lane.left, lane.left + lane.width),
    y: track ? track.top + track.height / 2 : lane.top + 28,
  }
}

function namedPoint(name: string): Point | null {
  const box = targetBox(name)
  return box ? targetPoint(name, box) : null
}

/** Where a cursor points now, or null when its place is not on screen. */
export function cursorPoint(cursor: PresenceCursor, m: Measured): Point | null {
  if (cursor.target) return namedPoint(cursor.target)
  if (cursor.preview && m.previewBox) {
    return {
      x: m.previewBox.left + cursor.preview.x * m.previewBox.width,
      y: m.previewBox.top + cursor.preview.y * m.previewBox.height,
    }
  }
  const lane = m.timelineBox
  if (!lane) return null
  if (cursor.item) {
    const box = m.itemBox(cursor.item)
    if (!box) return null
    return {
      x: clamp(box.left + Math.min(24, box.width / 2), lane.left, lane.left + lane.width),
      y: box.top + box.height / 2,
    }
  }
  return cursor.frame === undefined ? null : framePoint(cursor.frame, cursor.trackId, m)
}

/** Where a drag ends. */
export function placePoint(place: PresencePlace, m: Measured): Point | null {
  return 'target' in place ? namedPoint(place.target) : framePoint(place.frame, place.trackId, m)
}

/** The box a cursor's own place covers: its target or its item. */
export function cursorBox(cursor: PresenceCursor, m: Measured): Box | null {
  if (cursor.target) return targetBox(cursor.target)
  return cursor.item ? m.itemBox(cursor.item) : null
}

/** Frames `from`..`to` of a track, cut to the part of the timeline on screen. */
export function spanBox(trackId: string, from: number, to: number, m: Measured): Box | null {
  const lane = m.timelineBox
  const track = m.trackBox(trackId)
  const x1 = m.frameX(from)
  const x2 = m.frameX(to)
  if (!lane || !track || x1 === null || x2 === null) return null
  const left = Math.max(x1, lane.left)
  const right = Math.min(Math.max(x2, x1 + 2), lane.left + lane.width)
  return right > left ? { left, top: track.top, width: right - left, height: track.height } : null
}

export function highlightBox(highlight: PresenceHighlight, m: Measured): Box | null {
  const lane = m.timelineBox
  if (!lane) return null
  if (highlight.trackId && highlight.from !== undefined && highlight.to !== undefined) {
    return spanBox(highlight.trackId, highlight.from, highlight.to, m)
  }
  const box = highlight.item ? m.itemBox(highlight.item) : null
  if (!box) return null
  const left = Math.max(box.left, lane.left)
  const right = Math.min(box.left + box.width, lane.left + lane.width)
  return right > left ? { ...box, left, width: right - left } : null
}
