import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePresenceStore, type PresenceCursor } from '../stores/presence-store'
import {
  gestureDuration,
  layoutGesture,
  movesCursor,
  type GestureElements,
} from './presence-gesture-layout'
import { CursorGestureParts, GestureLayer, PRESENCE_KEYFRAMES } from './presence-gestures'
import { cursorPoint, highlightBox, measure, type Measured } from './presence-measure'
import { CHARACTER_KEYFRAMES, PresenceCharacter } from './presence-character'

/** Dark text on a light hex color, light text on everything else. */
function labelInk(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1]
  if (!hex) return '#ffffff'
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55 ? '#111111' : '#ffffff'
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Where each character last stood and when it last moved: it walks while it moves. */
type Steps = Map<string, { x: number; y: number; movedAt: number }>

/** How long a character keeps walking after its last move (its glide is 420 ms). */
const WALK_TAIL_MS = 450

function noteWalking(
  id: string,
  point: { x: number; y: number },
  el: HTMLDivElement,
  steps: Steps,
  now: number,
) {
  const last = steps.get(id)
  const moved = !last || Math.hypot(point.x - last.x, point.y - last.y) > 0.5
  const movedAt = moved && last ? now : (last?.movedAt ?? -Infinity)
  steps.set(id, { x: point.x, y: point.y, movedAt })
  const character = el.querySelector<HTMLElement>('[data-presence-character]')
  if (character) character.dataset.walking = now - movedAt < WALK_TAIL_MS ? 'true' : 'false'
}

/** When each cursor's current gesture began, so a repeated message continues it. */
type GestureClock = Map<string, { key: string; at: number }>

function gestureProgress(cursor: PresenceCursor, clock: GestureClock, now: number, still: boolean) {
  const gesture = cursor.gesture
  if (!gesture) {
    // Gone from the message: the same gesture sent again later plays again.
    clock.delete(cursor.id)
    return 1
  }
  const started = clock.get(cursor.id)
  const at = started?.key === gesture.key ? started.at : now
  if (started?.key !== gesture.key) clock.set(cursor.id, { key: gesture.key, at })
  const duration = gestureDuration(gesture)
  return still || duration <= 0 ? 1 : Math.min(1, (now - at) / duration)
}

/** An agent at its home on a lane, waiting or done: drawn smaller, with no name tag. */
export const isAtHome = (cursor: PresenceCursor) =>
  !cursor.gesture &&
  (cursor.target?.startsWith('lane.') ?? false) &&
  (cursor.mood === 'waiting' || cursor.mood === 'done')

/** How far a home's agents sit from its first one: four to a row, right to left. */
const SEAT_STEP_X = 32
const SEAT_STEP_Y = 34
const SEATS_PER_ROW = 4

/**
 * Where each agent sits among the others at the same home, so a crowded lane
 * shows them side by side instead of one on top of the other.
 */
export function seatOffsets(
  cursors: readonly PresenceCursor[],
  homeOf: (cursor: PresenceCursor) => string | null,
): Map<string, { dx: number; dy: number }> {
  const taken = new Map<string, number>()
  const offsets = new Map<string, { dx: number; dy: number }>()
  for (const cursor of cursors) {
    // Two lanes can share one home (no lane of their own yet): seat by where it is.
    const home = isAtHome(cursor) ? homeOf(cursor) : null
    if (home === null) continue
    const seat = taken.get(home) ?? 0
    taken.set(home, seat + 1)
    offsets.set(cursor.id, {
      dx: -(seat % SEATS_PER_ROW) * SEAT_STEP_X,
      dy: Math.floor(seat / SEATS_PER_ROW) * SEAT_STEP_Y,
    })
  }
  return offsets
}

interface Frame {
  readonly m: Measured
  readonly now: number
  readonly glide: string
  readonly still: boolean
}

function placeCursor(
  cursor: PresenceCursor,
  el: HTMLDivElement,
  frame: Frame,
  clock: GestureClock,
  elements: GestureElements | undefined,
  steps: Steps,
  seat: { dx: number; dy: number } | undefined,
): void {
  const at = cursorPoint(cursor, frame.m)
  const base = at && seat ? { x: at.x + seat.dx, y: at.y + seat.dy } : at
  const gesture = cursor.gesture
  const t = gestureProgress(cursor, clock, frame.now, frame.still)
  const point = gesture ? layoutGesture(cursor, gesture, base, t, frame.m, elements ?? {}) : base
  // The gesture moves the cursor itself frame by frame; a glide would lag behind it.
  const moving = gesture !== undefined && movesCursor(gesture) && t < 1
  el.style.transition = moving ? 'opacity 200ms' : `${frame.glide}, opacity 200ms`
  el.style.opacity = point ? '1' : '0'
  if (point) {
    el.style.transform = `translate(${point.x}px, ${point.y}px)`
    noteWalking(cursor.id, point, el, steps, frame.now)
  }
}

/**
 * The parent's collaborators, drawn over the editor (NODARO_PRESENCE): a named
 * cursor for each, gliding to what it works on (a named target, an item, a
 * frame or a point of the preview), its gesture if it has one, and tinted
 * spans of the timeline. It never takes a click, and it follows zoom and scroll
 * every frame.
 */
export function PresenceOverlay() {
  const cursors = usePresenceStore((s) => s.cursors)
  const highlights = usePresenceStore((s) => s.highlights)
  const cursorRefs = useRef(new Map<string, HTMLDivElement>())
  const highlightRefs = useRef(new Map<string, HTMLDivElement>())
  const gestureRefs = useRef(new Map<string, GestureElements>())
  const clock = useRef<GestureClock>(new Map())
  const steps = useRef<Steps>(new Map())
  const active = cursors.length > 0 || highlights.length > 0
  const reduceMotion = prefersReducedMotion()

  useEffect(() => {
    // Forget the cursors the parent no longer sends.
    const ids = new Set(cursors.map((cursor) => cursor.id))
    for (const map of [clock.current, gestureRefs.current, steps.current]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id)
    }
    if (!active) return
    let frameId = 0
    const glide = reduceMotion ? 'none' : 'transform 420ms cubic-bezier(0.2, 0.7, 0.2, 1)'
    const tick = () => {
      const frame: Frame = {
        m: measure(),
        now: performance.now(),
        glide,
        still: reduceMotion,
      }
      const seats = seatOffsets(cursors, (cursor) => {
        const point = cursorPoint(cursor, frame.m)
        return point ? `${Math.round(point.x)}:${Math.round(point.y)}` : null
      })
      for (const cursor of cursors) {
        const el = cursorRefs.current.get(cursor.id)
        if (el) {
          placeCursor(
            cursor,
            el,
            frame,
            clock.current,
            gestureRefs.current.get(cursor.id),
            steps.current,
            seats.get(cursor.id),
          )
        }
      }
      for (const highlight of highlights) {
        const el = highlightRefs.current.get(highlight.id)
        if (!el) continue
        const box = highlightBox(highlight, frame.m)
        el.style.opacity = box ? '1' : '0'
        if (box) {
          el.style.transform = `translate(${box.left}px, ${box.top}px)`
          el.style.width = `${box.width}px`
          el.style.height = `${box.height}px`
        }
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [active, cursors, highlights, reduceMotion])

  if (!active) return null
  const register = (id: string) => (patch: GestureElements) =>
    gestureRefs.current.set(id, { ...gestureRefs.current.get(id), ...patch })

  return createPortal(
    <div
      aria-hidden="true"
      data-embedded-presence
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483000,
      }}
    >
      <style>{PRESENCE_KEYFRAMES + CHARACTER_KEYFRAMES}</style>
      {highlights.map((highlight) => (
        <div
          key={highlight.id}
          ref={(el) => {
            if (el) highlightRefs.current.set(highlight.id, el)
            else highlightRefs.current.delete(highlight.id)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: 0,
            borderRadius: 3,
            background: `color-mix(in srgb, ${highlight.color} 28%, transparent)`,
            boxShadow: `inset 0 0 0 1px ${highlight.color}`,
          }}
        />
      ))}
      {cursors.map((cursor) =>
        cursor.gesture ? (
          <GestureLayer
            key={`${cursor.id}:${cursor.gesture.key}`}
            gesture={cursor.gesture}
            color={cursor.color}
            reduceMotion={reduceMotion}
            register={register(cursor.id)}
          />
        ) : null,
      )}
      {cursors.map((cursor) => (
        <div
          key={cursor.id}
          data-presence-cursor={cursor.id}
          ref={(el) => {
            if (el) cursorRefs.current.set(cursor.id, el)
            else cursorRefs.current.delete(cursor.id)
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: 0,
            transition: 'opacity 200ms',
            willChange: 'transform',
          }}
        >
          {cursor.gesture ? (
            <CursorGestureParts
              key={cursor.gesture.key}
              gesture={cursor.gesture}
              color={cursor.color}
              reduceMotion={reduceMotion}
              register={register(cursor.id)}
            />
          ) : null}
          <div
            style={
              isAtHome(cursor) ? { transform: 'scale(0.72)', transformOrigin: '0 0' } : undefined
            }
          >
            <PresenceCharacter
              color={cursor.color}
              mood={cursor.mood ?? 'working'}
              walking={false}
              home={isAtHome(cursor)}
            />
          </div>
          <div
            hidden={isAtHome(cursor)}
            style={{
              position: 'absolute',
              left: 56,
              top: 18,
              padding: '4px 7px',
              borderRadius: 4,
              background: cursor.color,
              color: labelInk(cursor.color),
              font: '600 12px/1.2 Inter, "IBM Plex Sans", system-ui, sans-serif',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {cursor.name}
            {cursor.note ? (
              <span style={{ display: 'block', fontWeight: 400, opacity: 0.85 }}>
                {cursor.note}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  )
}
