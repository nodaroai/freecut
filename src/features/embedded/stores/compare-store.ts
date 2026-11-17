import { create } from 'zustand'

/**
 * What the program monitor shows (NODARO_PLAYBACK `compare`):
 * - `program`: the edit, as always;
 * - `source`: the original media of the timeline's first video clip, whole,
 *   played by the transport (the edit's cuts included);
 * - `split`: the original over the left part of the edit, up to a divider.
 */
export type CompareMode = 'program' | 'source' | 'split'

export const COMPARE_MODES: readonly CompareMode[] = ['program', 'source', 'split']

interface CompareState {
  /** The parent asked to compare: the Original | Split | Edited control shows from then on. */
  readonly offered: boolean
  readonly mode: CompareMode
  /** Where the split divider is, as a fraction of the picture's width from the left. */
  readonly split: number
  setMode: (mode: CompareMode, split?: number) => void
  setSplit: (split: number) => void
}

const clampSplit = (split: number) => Math.min(0.95, Math.max(0.05, split))

export const useCompareStore = create<CompareState>((set) => ({
  offered: false,
  mode: 'program',
  split: 0.5,
  setMode: (mode, split) =>
    set((state) => ({
      offered: true,
      mode,
      split: split === undefined ? state.split : clampSplit(split),
    })),
  setSplit: (split) => set({ split: clampSplit(split) }),
}))
