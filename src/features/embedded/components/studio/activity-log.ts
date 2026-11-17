import { create } from 'zustand'
import { usePresenceStore, type PresenceCursor } from '../../stores/presence-store'

/** One line of the agents' activity: who said what, when. */
export interface ActivityEntry {
  readonly key: number
  readonly at: number
  readonly agent: string
  readonly color: string
  readonly text: string
}

interface ActivityLine {
  readonly agent: string
  readonly color: string
  readonly text: string
}

const MAX_ENTRIES = 80
const FALLBACK_COLOR = '#a3a3b8'
const COLOR = /^#[0-9a-f]{3,8}$/i

interface ActivityState {
  readonly entries: readonly ActivityEntry[]
  /** The parent writes the log itself (NODARO_ACTIVITY): the cursors' notes are then not logged. */
  readonly fed: boolean
}

export const useActivityLog = create<ActivityState>(() => ({ entries: [], fed: false }))

let nextKey = 0

function append(lines: readonly ActivityLine[], at: number, fed: boolean) {
  const added = lines.map((line) => {
    nextKey += 1
    return { key: nextKey, at, agent: line.agent, color: line.color, text: line.text }
  })
  useActivityLog.setState((prev) => ({
    entries: [...prev.entries, ...added].slice(-MAX_ENTRIES),
    fed: prev.fed || fed,
  }))
}

/** The agent a cursor belongs to: a station character shares its agent's id. */
export function agentOf(cursor: PresenceCursor): string {
  return cursor.id.split('#')[0] ?? cursor.id
}

/**
 * The new lines a presence update adds: a cursor whose note differs from the
 * last one its agent said. Pure, so the log can be tested without a store.
 */
export function newLines(
  cursors: readonly PresenceCursor[],
  lastSaid: ReadonlyMap<string, string>,
): ReadonlyArray<{ agent: string; name: string; color: string; text: string }> {
  const lines: Array<{ agent: string; name: string; color: string; text: string }> = []
  for (const cursor of cursors) {
    const text = cursor.note?.trim()
    if (!text) continue
    const agent = agentOf(cursor)
    if (lastSaid.get(agent) === text) continue
    if (lines.some((line) => line.agent === agent && line.text === text)) continue
    lines.push({ agent, name: cursor.name, color: cursor.color, text })
  }
  return lines
}

/** The lines a NODARO_ACTIVITY payload carries: each a short agent name, a colour and a text. */
export function readActivityLines(payload: unknown): ActivityLine[] {
  const lines = (payload as { lines?: unknown } | null)?.lines
  if (!Array.isArray(lines)) return []
  return lines.flatMap((raw) => {
    const line = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const text = typeof line.text === 'string' ? line.text.trim().slice(0, 200) : ''
    const agent = typeof line.agent === 'string' ? line.agent.trim().slice(0, 24) : ''
    if (!text || !agent) return []
    const color =
      typeof line.color === 'string' && COLOR.test(line.color) ? line.color : FALLBACK_COLOR
    return [{ agent, color, text }]
  })
}

/** NODARO_ACTIVITY { lines }: the parent adds lines to the agents' log. */
export function handleActivity(event: MessageEvent, now: () => number = Date.now): void {
  const lines = readActivityLines(event.data?.payload)
  if (lines.length > 0) append(lines, now(), true)
}

/** Log what the cursors say while the parent does not write the log itself; returns the stop. */
export function watchActivity(now: () => number = Date.now): () => void {
  const lastSaid = new Map<string, string>()
  return usePresenceStore.subscribe((state) => {
    if (useActivityLog.getState().fed) return
    const lines = newLines(state.cursors, lastSaid)
    if (lines.length === 0) return
    for (const line of lines) lastSaid.set(line.agent, line.text)
    append(
      lines.map((line) => ({ agent: line.name, color: line.color, text: line.text })),
      now(),
      false,
    )
  })
}
