import type {
  PresenceCursor,
  PresenceGesture,
  PresencePreviewPoint,
} from '../stores/presence-store'
import {
  clamp,
  cursorBox,
  placePoint,
  spanBox,
  type Measured,
  type Point,
} from './presence-measure'
import type { Box } from './presence-targets'

/** The elements a gesture draws outside its cursor, placed every frame. */
export interface GestureElements {
  outline?: HTMLDivElement | null
  marquee?: HTMLDivElement | null
  lasso?: SVGSVGElement | null
  lassoLine?: SVGPolylineElement | null
  knob?: HTMLDivElement | null
  badge?: HTMLDivElement | null
  bar?: HTMLDivElement | null
  typed?: HTMLSpanElement | null
}

/** How long a gesture plays before it rests in its final state. */
export function gestureDuration(gesture: PresenceGesture): number {
  if ('durationMs' in gesture) return gesture.durationMs
  if (gesture.kind === 'click') return 900
  return gesture.kind === 'marquee' ? 500 : 0
}

/** True while the cursor itself is moved by the gesture (no glide then). */
export const movesCursor = (gesture: PresenceGesture) =>
  gesture.kind === 'drag' ||
  gesture.kind === 'lasso' ||
  gesture.kind === 'slide' ||
  gesture.kind === 'marquee'

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const lerp = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
})

function place(el: HTMLElement | SVGElement | null | undefined, box: Box | null): void {
  if (!el) return
  el.style.opacity = box ? '1' : '0'
  if (!box) return
  el.style.transform = `translate(${box.left}px, ${box.top}px)`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}

/** The point `t` (0..1) of the way along a polyline in preview fractions. */
function along(points: readonly PresencePreviewPoint[], t: number): PresencePreviewPoint {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let remaining = t * total
  for (const [i, length] of lengths.entries()) {
    if (remaining <= length && length > 0) {
      const a = points[i]!
      const b = points[i + 1]!
      return {
        x: a.x + ((b.x - a.x) * remaining) / length,
        y: a.y + ((b.y - a.y) * remaining) / length,
      }
    }
    remaining -= length
  }
  return points.at(-1)!
}

function layoutLasso(
  gesture: Extract<PresenceGesture, { kind: 'lasso' }>,
  t: number,
  m: Measured,
  els: GestureElements,
): Point | null {
  place(els.lasso, m.previewBox)
  if (els.lassoLine) els.lassoLine.style.strokeDashoffset = String(1 - t)
  const box = m.previewBox
  if (!box) return null
  const at = along(gesture.points, t)
  return { x: box.left + at.x * box.width, y: box.top + at.y * box.height }
}

function layoutSlide(
  gesture: Extract<PresenceGesture, { kind: 'slide' }>,
  t: number,
  box: Box | null,
  els: GestureElements,
): Point | null {
  if (!box) {
    place(els.knob, null)
    return null
  }
  const x = box.left + (gesture.from + (gesture.to - gesture.from) * t) * box.width
  const y = box.top + box.height / 2
  place(els.knob, { left: x - 7, top: y - 7, width: 14, height: 14 })
  return { x, y }
}

function layoutBadge(value: number, box: Box | null, els: GestureElements): void {
  if (!box || !els.badge) {
    place(els.badge, null)
    return
  }
  const width = clamp(box.width, 96, 180)
  const top = box.top >= 30 ? box.top - 28 : box.top + 4
  place(els.badge, { left: box.left, top, width, height: 24 })
  if (els.bar) els.bar.style.width = `${Math.round(value * 100)}%`
}

/**
 * Draw one frame of a gesture and answer where its cursor is: `base` (where
 * the cursor points) for gestures that leave it there, or the moving point.
 * `t` is how far the gesture has played, 0..1.
 */
export function layoutGesture(
  cursor: PresenceCursor,
  gesture: PresenceGesture,
  base: Point | null,
  t: number,
  m: Measured,
  els: GestureElements,
): Point | null {
  switch (gesture.kind) {
    case 'click':
      place(els.outline, cursorBox(cursor, m))
      return base
    case 'drag': {
      const to = placePoint(gesture.to, m)
      return base && to ? lerp(base, to, ease(t)) : base
    }
    case 'type':
      if (els.typed)
        els.typed.textContent = gesture.text.slice(0, Math.ceil(t * gesture.text.length))
      return base
    case 'marquee': {
      const span = spanBox(gesture.trackId, gesture.from, gesture.to, m)
      const grown = span ? { ...span, width: Math.max(2, span.width * ease(t)) } : null
      place(els.marquee, grown)
      return grown ? { x: grown.left + grown.width, y: grown.top + grown.height / 2 } : base
    }
    case 'lasso':
      return layoutLasso(gesture, t, m, els) ?? base
    case 'slide':
      return layoutSlide(gesture, ease(t), cursorBox(cursor, m), els) ?? base
    case 'progress':
      layoutBadge(gesture.value, cursorBox(cursor, m), els)
      return base
  }
}
