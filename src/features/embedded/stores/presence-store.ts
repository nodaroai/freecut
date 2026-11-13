import { create } from 'zustand'

/**
 * A collaborator's cursor that a parent draws over the editor
 * (NODARO_PRESENCE). It points at one place:
 * - an item on the timeline (`item`, an item id), or
 * - a frame of the timeline (`frame`, on the track `trackId` when given), or
 * - a point of the preview (`preview`, x and y as fractions of its width and height).
 */
export interface PresenceCursor {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly item?: string
  readonly frame?: number
  readonly trackId?: string
  readonly preview?: { readonly x: number; readonly y: number }
  /** A short line shown under the name, such as what the collaborator is doing. */
  readonly note?: string
}

/** A tinted span of the timeline: one item, or frames `from`..`to` on a track. */
export interface PresenceHighlight {
  readonly id: string
  readonly color: string
  readonly item?: string
  readonly trackId?: string
  readonly from?: number
  readonly to?: number
}

interface PresenceState {
  readonly cursors: readonly PresenceCursor[]
  readonly highlights: readonly PresenceHighlight[]
  setPresence: (
    cursors: readonly PresenceCursor[],
    highlights: readonly PresenceHighlight[],
  ) => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  cursors: [],
  highlights: [],
  setPresence: (cursors, highlights) => set({ cursors, highlights }),
}))
