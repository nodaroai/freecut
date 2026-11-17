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

const MAX_ENTRIES = 80

interface ActivityState {
  readonly entries: readonly ActivityEntry[]
}

export const useActivityLog = create<ActivityState>(() => ({ entries: [] }))

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

/** Keep the log while presence changes; returns the stop. */
export function watchActivity(now: () => number = Date.now): () => void {
  const lastSaid = new Map<string, string>()
  let key = 0
  return usePresenceStore.subscribe((state) => {
    const lines = newLines(state.cursors, lastSaid)
    if (lines.length === 0) return
    const at = now()
    const added = lines.map((line) => {
      lastSaid.set(line.agent, line.text)
      key += 1
      return { key, at, agent: line.name, color: line.color, text: line.text }
    })
    useActivityLog.setState((prev) => ({
      entries: [...prev.entries, ...added].slice(-MAX_ENTRIES),
    }))
  })
}
