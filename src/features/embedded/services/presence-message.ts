import {
  usePresenceStore,
  type PresenceCursor,
  type PresenceHighlight,
} from '../stores/presence-store'
import { parseGesture } from './presence-gesture'
import { color, fraction, frame, targetName, text } from './presence-values'

const MAX_CURSORS = 12
const MAX_HIGHLIGHTS = 64
const MAX_NAME = 40
const MAX_NOTE = 80

function parseCursor(value: unknown): PresenceCursor | null {
  const raw = (value ?? {}) as Record<string, unknown>
  const id = text(raw.id, 64)
  const name = text(raw.name, MAX_NAME)
  const tint = color(raw.color)
  if (!id || !name || !tint) return null
  const preview = raw.preview as { x?: unknown; y?: unknown } | undefined
  const x = fraction(preview?.x)
  const y = fraction(preview?.y)
  const target = targetName(raw.target)
  const item = text(raw.item, 128)
  const at = frame(raw.frame)
  const trackId = text(raw.trackId, 128)
  const note = text(raw.note, MAX_NOTE)
  const gesture = parseGesture(raw.gesture)
  return {
    id,
    name,
    color: tint,
    ...(target ? { target } : {}),
    ...(item ? { item } : {}),
    ...(at === undefined ? {} : { frame: at }),
    ...(trackId ? { trackId } : {}),
    ...(x === undefined || y === undefined ? {} : { preview: { x, y } }),
    ...(note ? { note } : {}),
    ...(gesture ? { gesture } : {}),
  }
}

function parseHighlight(value: unknown): PresenceHighlight | null {
  const raw = (value ?? {}) as Record<string, unknown>
  const id = text(raw.id, 64)
  const tint = color(raw.color)
  if (!id || !tint) return null
  const item = text(raw.item, 128)
  const trackId = text(raw.trackId, 128)
  const from = frame(raw.from)
  const to = frame(raw.to)
  if (item) return { id, color: tint, item }
  if (trackId && from !== undefined && to !== undefined && to > from) {
    return { id, color: tint, trackId, from, to }
  }
  return null
}

/** The valid entries, first of each id, at most `max` of them. */
function parseList<T extends { id: string }>(
  value: unknown,
  parse: (entry: unknown) => T | null,
  max: number,
): T[] {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const raw of Array.isArray(value) ? value : []) {
    if (kept.length >= max) break
    const entry = parse(raw)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    kept.push(entry)
  }
  return kept
}

/**
 * NODARO_PRESENCE { cursors, highlights }: what the parent's collaborators are
 * doing, drawn over the editor. Each message replaces the whole picture, so an
 * empty message clears it. A cursor may point at a named target (`target`)
 * and carry a `gesture` (see `PresenceGesture`). No reply.
 */
export function handlePresence(event: MessageEvent): void {
  const payload = (event.data?.payload ?? {}) as { cursors?: unknown; highlights?: unknown }
  usePresenceStore
    .getState()
    .setPresence(
      parseList(payload.cursors, parseCursor, MAX_CURSORS),
      parseList(payload.highlights, parseHighlight, MAX_HIGHLIGHTS),
    )
}
