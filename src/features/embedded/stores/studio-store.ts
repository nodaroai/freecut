import { create } from 'zustand'

/**
 * The studio layout a parent can ask for (NODARO_STUDIO): every panel in one
 * work row (media, source and the agents' activity, program, scopes, and a
 * slot the parent fills with its own side panel), the timeline across the
 * whole width under it, one top bar and a status bar. Off until asked.
 */
interface StudioState {
  /** The parent asked for the studio layout. */
  readonly on: boolean
  /** The parent's side panel is open (the top bar's Edit with AI is pressed). */
  readonly sideOpen: boolean
  /** How wide a slot to keep for the parent's side panel, in CSS px. */
  readonly sideWidth: number
  /** What the top bar's side-panel button says. */
  readonly sideLabel: string
  /** The origin of the page that asked, the only one told what happens here. */
  readonly origin: string | null
  setStudio: (next: {
    sideOpen: boolean
    sideWidth: number
    sideLabel: string
    origin: string
  }) => void
}

export const useStudioStore = create<StudioState>((set) => ({
  on: false,
  sideOpen: false,
  sideWidth: 0,
  sideLabel: '',
  origin: null,
  setStudio: (next) => set({ on: true, ...next }),
}))
