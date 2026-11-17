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

/** Dark text on a light hex color, light text on everything else. */
function labelInk(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1]
  if (!hex) return '#ffffff'
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55 ? '#111111' : '#ffffff'
}

const ARROW = 'M1.5 1.5 L1.5 13.5 L4.9 10.3 L7.4 15 L9.7 14 L7.2 9.3 L12 9.3 Z'

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

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
): void {
  const base = cursorPoint(cursor, frame.m)
  const gesture = cursor.gesture
  const t = gestureProgress(cursor, clock, frame.now, frame.still)
  const point = gesture ? layoutGesture(cursor, gesture, base, t, frame.m, elements ?? {}) : base
  // The gesture moves the cursor itself frame by frame; a glide would lag behind it.
  const moving = gesture !== undefined && movesCursor(gesture) && t < 1
  el.style.transition = moving ? 'opacity 200ms' : `${frame.glide}, opacity 200ms`
  el.style.opacity = point ? '1' : '0'
  if (point) el.style.transform = `translate(${point.x}px, ${point.y}px)`
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
  const active = cursors.length > 0 || highlights.length > 0
  const reduceMotion = prefersReducedMotion()

  useEffect(() => {
    // Forget the cursors the parent no longer sends.
    const ids = new Set(cursors.map((cursor) => cursor.id))
    for (const map of [clock.current, gestureRefs.current]) {
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id)
    }
    if (!active) return
    let frameId = 0
    const glide = reduceMotion ? 'none' : 'transform 420ms cubic-bezier(0.2, 0.7, 0.2, 1)'
    const tick = () => {
      const frame: Frame = { m: measure(), now: performance.now(), glide, still: reduceMotion }
      for (const cursor of cursors) {
        const el = cursorRefs.current.get(cursor.id)
        if (el) placeCursor(cursor, el, frame, clock.current, gestureRefs.current.get(cursor.id))
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
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }}
    >
      <style>{PRESENCE_KEYFRAMES}</style>
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
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            style={{ display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.55))' }}
          >
            <path d={ARROW} fill={cursor.color} stroke="rgba(0,0,0,0.75)" strokeWidth="1.2" />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: 15,
              top: 16,
              padding: '4px 7px',
              borderRadius: 4,
              background: cursor.color,
              color: labelInk(cursor.color),
              font: '600 12px/1.2 "IBM Plex Sans", system-ui, sans-serif',
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
