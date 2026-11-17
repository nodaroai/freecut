import type { PresenceCursor, PresenceMood } from '../../stores/presence-store'
import { agentOf } from './activity-log'

/** One agent of the crew, as the top bar shows it. */
export interface CrewMember {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly mood: PresenceMood
}

/**
 * The crew the cursors make: one member per agent (its station character and
 * its working cursor are one agent), at work when any of its cursors carries
 * no mood, otherwise in the mood its cursor shows. In the order they appear.
 */
export function crewOf(cursors: readonly PresenceCursor[]): CrewMember[] {
  const crew = new Map<string, CrewMember>()
  for (const cursor of cursors) {
    const id = agentOf(cursor)
    const mood: PresenceMood = cursor.mood ?? 'working'
    const seen = crew.get(id)
    if (!seen) crew.set(id, { id, name: cursor.name, color: cursor.color, mood })
    else if (mood === 'working' || mood === 'needs-you') crew.set(id, { ...seen, mood })
  }
  return [...crew.values()]
}
