import {
  usePresenceStore,
  type PresenceCursor,
  type PresenceHighlight,
} from '../stores/presence-store'

const MAX_CURSORS = 12
const MAX_HIGHLIGHTS = 64
const MAX_NAME = 40
const MAX_NOTE = 80

// A color a parent may give: hex, rgb()/rgba() or hsl()/hsla(). Nothing else reaches a style.
const COLOR =
  /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d[\d\s.,%]*\)|hsla?\(\s*\d[\d\s.,%deg]*\))$/i

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined
const frame = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
const fraction = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined
const color = (value: unknown): string | undefined =>
  typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : undefined

function parseCursor(value: unknown): PresenceCursor | null {
  const raw = (value ?? {}) as Record<string, unknown>
  const id = text(raw.id, 64)
  const name = text(raw.name, MAX_NAME)
  const tint = color(raw.color)
  if (!id || !name || !tint) return null
  const preview = raw.preview as { x?: unknown; y?: unknown } | undefined
  const x = fraction(preview?.x)
  const y = fraction(preview?.y)
  const item = text(raw.item, 128)
  const at = frame(raw.frame)
  const trackId = text(raw.trackId, 128)
  const note = text(raw.note, MAX_NOTE)
  return {
    id,
    name,
    color: tint,
    ...(item ? { item } : {}),
    ...(at === undefined ? {} : { frame: at }),
    ...(trackId ? { trackId } : {}),
    ...(x === undefined || y === undefined ? {} : { preview: { x, y } }),
    ...(note ? { note } : {}),
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
 * empty message clears it. No reply.
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
