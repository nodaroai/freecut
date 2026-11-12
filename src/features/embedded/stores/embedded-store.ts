import { create } from 'zustand'

interface InputMetadata {
  codec: string
  width: number
  height: number
  fps: number
}

/**
 * What Save & Exit hands the parent, as NODARO_LOAD_VIDEO's `saveExit` asks:
 * - `project` (the default): the project JSON alone, in FREECUT_SAVE_EXIT.
 * - `video`: the timeline rendered to a video, with the project JSON, in
 *   FREECUT_EXPORT_COMPLETE.
 */
export type SaveExitMode = 'video' | 'project'

interface EmbeddedState {
  isEmbedded: boolean
  isImporting: boolean
  parentOrigin: string | null
  inputMetadata: InputMetadata | null
  pendingVideoImport: { mediaId: string } | null
  sendBackStatus: 'idle' | 'saving' | 'sent' | 'error'
  saveExitMode: SaveExitMode
}

interface EmbeddedActions {
  setIsImporting: (v: boolean) => void
  setParentOrigin: (origin: string) => void
  setInputMetadata: (meta: InputMetadata) => void
  setPendingVideoImport: (pending: { mediaId: string } | null) => void
  setSendBackStatus: (status: EmbeddedState['sendBackStatus']) => void
  setSaveExitMode: (mode: SaveExitMode) => void
}

function detectEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export const useEmbeddedStore = create<EmbeddedState & EmbeddedActions>((set) => ({
  isEmbedded: detectEmbedded(),
  isImporting: false,
  parentOrigin: null,
  inputMetadata: null,
  pendingVideoImport: null,
  sendBackStatus: 'idle',
  saveExitMode: 'project',

  setIsImporting: (isImporting) => set({ isImporting }),
  setParentOrigin: (parentOrigin) => set({ parentOrigin }),
  setInputMetadata: (inputMetadata) => set({ inputMetadata }),
  setPendingVideoImport: (pendingVideoImport) => set({ pendingVideoImport }),
  setSendBackStatus: (sendBackStatus) => set({ sendBackStatus }),
  setSaveExitMode: (saveExitMode) => set({ saveExitMode }),
}))

export function isEmbedded(): boolean {
  return useEmbeddedStore.getState().isEmbedded
}
