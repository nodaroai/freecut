import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useItemsStore } from '../deps/timeline-contract'
import {
  usePresenceStore,
  type PresenceCursor,
  type PresenceHighlight,
} from '../stores/presence-store'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const toBox = (el: Element | null): Box | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
    ? { left: r.left, top: r.top, width: r.width, height: r.height }
    : null
}

const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`

/**
 * Where things are on screen right now. The timeline has no fixed frame-to-pixel
 * origin a feature can read, so it is measured from any item the timeline is
 * showing: its box and its `from` / `durationInFrames` give both the scale and
 * the origin, whatever the zoom and scroll.
 */
function measure() {
  const timeline = document.querySelector('[data-timeline-scroll-container]')
  const timelineBox = toBox(timeline)
  const itemBox = (id: string) => toBox(timeline?.querySelector(attr('data-item-id', id)) ?? null)
  const trackBox = (id: string) => toBox(timeline?.querySelector(attr('data-track-id', id)) ?? null)

  let scale: { origin: number; perFrame: number } | null = null
  for (const item of useItemsStore.getState().items) {
    const box = itemBox(item.id)
    if (!box || item.durationInFrames <= 0) continue
    const perFrame = box.width / item.durationInFrames
    scale = { origin: box.left - item.from * perFrame, perFrame }
    break
  }
  const frameX = (frame: number) => (scale ? scale.origin + frame * scale.perFrame : null)

  return {
    timelineBox,
    itemBox,
    trackBox,
    frameX,
    previewBox: toBox(document.querySelector('[data-player-container]')),
  }
}

type Measured = ReturnType<typeof measure>

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function cursorPoint(cursor: PresenceCursor, m: Measured): { x: number; y: number } | null {
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
  if (cursor.frame !== undefined) {
    const x = m.frameX(cursor.frame)
    if (x === null) return null
    const track = cursor.trackId ? m.trackBox(cursor.trackId) : null
    return {
      x: clamp(x, lane.left, lane.left + lane.width),
      y: track ? track.top + track.height / 2 : lane.top + 28,
    }
  }
  return null
}

function highlightBox(highlight: PresenceHighlight, m: Measured): Box | null {
  const lane = m.timelineBox
  if (!lane) return null
  let box: Box | null = null
  if (highlight.item) box = m.itemBox(highlight.item)
  else if (highlight.trackId && highlight.from !== undefined && highlight.to !== undefined) {
    const track = m.trackBox(highlight.trackId)
    const x1 = m.frameX(highlight.from)
    const x2 = m.frameX(highlight.to)
    if (track && x1 !== null && x2 !== null) {
      box = { left: x1, top: track.top, width: Math.max(2, x2 - x1), height: track.height }
    }
  }
  if (!box) return null
  const left = Math.max(box.left, lane.left)
  const right = Math.min(box.left + box.width, lane.left + lane.width)
  return right > left ? { ...box, left, width: right - left } : null
}

/** Dark text on a light hex color, light text on everything else. */
function labelInk(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(color)?.[1]
  if (!hex) return '#ffffff'
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.55 ? '#111111' : '#ffffff'
}

const ARROW = 'M1.5 1.5 L1.5 13.5 L4.9 10.3 L7.4 15 L9.7 14 L7.2 9.3 L12 9.3 Z'

/**
 * The parent's collaborators, drawn over the editor (NODARO_PRESENCE): a named
 * cursor for each, gliding to what it works on, and tinted spans of the
 * timeline. It never takes a click, and it follows zoom and scroll every frame.
 */
export function PresenceOverlay() {
  const cursors = usePresenceStore((s) => s.cursors)
  const highlights = usePresenceStore((s) => s.highlights)
  const cursorRefs = useRef(new Map<string, HTMLDivElement>())
  const highlightRefs = useRef(new Map<string, HTMLDivElement>())
  const active = cursors.length > 0 || highlights.length > 0

  useEffect(() => {
    if (!active) return
    let frameId = 0
    const tick = () => {
      const m = measure()
      for (const cursor of cursors) {
        const el = cursorRefs.current.get(cursor.id)
        if (!el) continue
        const point = cursorPoint(cursor, m)
        el.style.opacity = point ? '1' : '0'
        if (point) el.style.transform = `translate(${point.x}px, ${point.y}px)`
      }
      for (const highlight of highlights) {
        const el = highlightRefs.current.get(highlight.id)
        if (!el) continue
        const box = highlightBox(highlight, m)
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
  }, [active, cursors, highlights])

  if (!active) return null
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const glide = reduceMotion ? 'none' : 'transform 420ms cubic-bezier(0.2, 0.7, 0.2, 1)'

  return createPortal(
    <div
      aria-hidden="true"
      data-embedded-presence
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000 }}
    >
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
            transition: `${glide}, opacity 200ms`,
            willChange: 'transform',
          }}
        >
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
