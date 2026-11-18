import { create } from 'zustand'

/** A point of the preview, x and y as fractions of its width and height. */
export interface PresencePreviewPoint {
  readonly x: number
  readonly y: number
}

/** Where a drag ends: a named target, or a frame of the timeline (on a track when given). */
export type PresencePlace =
  | { readonly target: string }
  | { readonly frame: number; readonly trackId?: string }

/**
 * Something a collaborator is shown doing at its cursor. It is drawn only: the
 * editor gets no input from it. `key` identifies the gesture, so a message that
 * repeats it continues it instead of starting it again.
 * - `click`: a ripple at the cursor and a brief outline of its target.
 * - `drag`: the cursor travels to `to` over `durationMs`, carrying a chip.
 * - `type`: a bubble at the cursor reveals `text` over `durationMs`.
 * - `marquee`: a selection rectangle over frames `from`..`to` of a track.
 * - `lasso`: a shape over the preview, drawn point by point over `durationMs`.
 * - `slide`: a knob moving from `from` to `to` (fractions) across the target's width.
 * - `progress`: a badge with a bar (`value`, 0..1) on the target.
 */
export type PresenceGesture = { readonly key: string } & (
  | { readonly kind: 'click' }
  | {
      readonly kind: 'drag'
      readonly to: PresencePlace
      readonly label?: string
      readonly durationMs: number
    }
  | { readonly kind: 'type'; readonly text: string; readonly durationMs: number }
  | {
      readonly kind: 'marquee'
      readonly trackId: string
      readonly from: number
      readonly to: number
    }
  | {
      readonly kind: 'lasso'
      readonly points: readonly PresencePreviewPoint[]
      readonly durationMs: number
    }
  | {
      readonly kind: 'slide'
      readonly from: number
      readonly to: number
      readonly durationMs: number
    }
  | { readonly kind: 'progress'; readonly value: number; readonly label?: string }
  /** A range of a track cut out: blades drop at both ends, then the range closes. */
  | {
      readonly kind: 'cut'
      readonly trackId: string
      readonly from: number
      readonly to: number
      readonly durationMs: number
    }
  /** A frame drawn on the preview that moves from one rectangle to another (fractions of the picture). */
  | {
      readonly kind: 'frame'
      readonly from: PresenceRect
      readonly to: PresenceRect
      readonly durationMs: number
    }
)

/** A rectangle on the preview, in fractions of the picture. */
export interface PresenceRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * A collaborator's cursor that a parent draws over the editor
 * (NODARO_PRESENCE). It points at one place:
 * - a named part of the editor (`target`, see `presence-targets.ts`), or
 * - an item on the timeline (`item`, an item id), or
 * - a frame of the timeline (`frame`, on the track `trackId` when given), or
 * - a point of the preview (`preview`, x and y as fractions of its width and height).
 */
/**
 * What a collaborator is doing, shown on its character: at work (the default),
 * waiting its turn, done, or stopped until the person answers.
 */
export type PresenceMood = 'working' | 'waiting' | 'done' | 'needs-you'

export interface PresenceCursor {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly target?: string
  readonly item?: string
  readonly frame?: number
  readonly trackId?: string
  readonly preview?: PresencePreviewPoint
  /** A short line shown under the name, such as what the collaborator is doing. */
  readonly note?: string
  readonly gesture?: PresenceGesture
  /** What it is doing; absent means at work. */
  readonly mood?: PresenceMood
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
