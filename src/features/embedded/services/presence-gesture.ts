import type {
  PresenceGesture,
  PresencePlace,
  PresencePreviewPoint,
  PresenceRect,
} from '../stores/presence-store'
import { fraction, frame, targetName, text } from './presence-values'

const MAX_TEXT = 200
const MAX_LABEL = 40
const MAX_POINTS = 200
const MAX_DURATION_MS = 15_000

const DEFAULT_DURATION_MS = {
  drag: 900,
  type: 1200,
  lasso: 1200,
  slide: 900,
  cut: 700,
  frame: 900,
} as const

type Raw = Record<string, unknown>

const duration = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(MAX_DURATION_MS, Math.round(value))
    : fallback

/** Where a drag ends: a target name, or `{ frame, trackId? }`. */
function place(value: unknown): PresencePlace | null {
  const target = targetName(value)
  if (target) return { target }
  const raw = (value ?? {}) as Raw
  const at = frame(raw.frame)
  if (at === undefined) return null
  const trackId = text(raw.trackId, 128)
  return { frame: at, ...(trackId ? { trackId } : {}) }
}

function points(value: unknown): PresencePreviewPoint[] | null {
  if (!Array.isArray(value)) return null
  const kept = value.slice(0, MAX_POINTS).flatMap((entry) => {
    const { x, y } = (entry ?? {}) as Raw
    const px = fraction(x)
    const py = fraction(y)
    return px === undefined || py === undefined ? [] : [{ x: px, y: py }]
  })
  return kept.length >= 2 ? kept : null
}

/** A rectangle inside the picture, or null when its numbers do not make one. */
function rect(value: unknown): PresenceRect | null {
  const { x, y, w, h } = (value ?? {}) as Raw
  const px = fraction(x)
  const py = fraction(y)
  const pw = fraction(w)
  const ph = fraction(h)
  if (px === undefined || py === undefined || pw === undefined || ph === undefined) return null
  return pw > 0 && ph > 0 ? { x: px, y: py, w: pw, h: ph } : null
}

type GestureBody = PresenceGesture extends infer G
  ? G extends unknown
    ? Omit<G, 'key'>
    : never
  : never

/** One reader per gesture the editor draws: its fields, or null when they do not make one. */
const GESTURES: Readonly<Record<string, (raw: Raw) => GestureBody | null>> = {
  click: () => ({ kind: 'click' }),
  drag: (raw) => {
    const to = place(raw.to)
    const label = text(raw.label, MAX_LABEL)
    if (!to) return null
    return {
      kind: 'drag',
      to,
      ...(label ? { label } : {}),
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.drag),
    }
  },
  type: (raw) => {
    const typed = text(raw.text, MAX_TEXT)
    if (!typed) return null
    return {
      kind: 'type',
      text: typed,
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.type),
    }
  },
  marquee: (raw) => {
    const trackId = text(raw.trackId, 128)
    const from = frame(raw.from)
    const to = frame(raw.to)
    if (!trackId || from === undefined || to === undefined || to <= from) return null
    return { kind: 'marquee', trackId, from, to }
  },
  lasso: (raw) => {
    const shape = points(raw.points)
    if (!shape) return null
    return {
      kind: 'lasso',
      points: shape,
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.lasso),
    }
  },
  slide: (raw) => {
    const from = fraction(raw.from)
    const to = fraction(raw.to)
    if (from === undefined || to === undefined) return null
    return {
      kind: 'slide',
      from,
      to,
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.slide),
    }
  },
  cut: (raw) => {
    const trackId = text(raw.trackId, 128)
    const from = frame(raw.from)
    const to = frame(raw.to)
    if (!trackId || from === undefined || to === undefined || to <= from) return null
    return {
      kind: 'cut',
      trackId,
      from,
      to,
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.cut),
    }
  },
  frame: (raw) => {
    const from = rect(raw.from)
    const to = rect(raw.to)
    if (!from || !to) return null
    return {
      kind: 'frame',
      from,
      to,
      durationMs: duration(raw.durationMs, DEFAULT_DURATION_MS.frame),
    }
  },
  progress: (raw) => {
    const value = fraction(raw.value)
    const label = text(raw.label, MAX_LABEL)
    if (value === undefined) return null
    return { kind: 'progress', value, ...(label ? { label } : {}) }
  },
}

function body(raw: Raw): GestureBody | null {
  const read =
    typeof raw.kind === 'string' && Object.hasOwn(GESTURES, raw.kind)
      ? GESTURES[raw.kind]
      : undefined
  return read ? read(raw) : null
}

/**
 * A cursor's gesture, or null when it is not one this editor draws. Its key is
 * its content (and the parent's own `id`, when it gives one to replay a gesture),
 * except for a progress badge, which keeps its key while its value moves.
 */
export function parseGesture(value: unknown): PresenceGesture | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Raw
  const parsed = body(raw)
  if (!parsed) return null
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : ''
  const identity = parsed.kind === 'progress' ? { kind: 'progress' } : parsed
  return { ...parsed, key: `${id}|${JSON.stringify(identity)}` } as PresenceGesture
}
