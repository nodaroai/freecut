import { create } from 'zustand'

interface InputMetadata {
  codec: string
  width: number
  height: number
  fps: number
}

interface EmbeddedState {
  isEmbedded: boolean
  isImporting: boolean
  parentOrigin: string | null
  inputMetadata: InputMetadata | null
  pendingVideoImport: { mediaId: string } | null
  sendBackStatus: 'idle' | 'saving' | 'sent' | 'error'
}

interface EmbeddedActions {
  setIsImporting: (v: boolean) => void
  setParentOrigin: (origin: string) => void
  setInputMetadata: (meta: InputMetadata) => void
  setPendingVideoImport: (pending: { mediaId: string } | null) => void
  setSendBackStatus: (status: EmbeddedState['sendBackStatus']) => void
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

  setIsImporting: (isImporting) => set({ isImporting }),
  setParentOrigin: (parentOrigin) => set({ parentOrigin }),
  setInputMetadata: (inputMetadata) => set({ inputMetadata }),
  setPendingVideoImport: (pendingVideoImport) => set({ pendingVideoImport }),
  setSendBackStatus: (sendBackStatus) => set({ sendBackStatus }),
}))

export function isEmbedded(): boolean {
  return useEmbeddedStore.getState().isEmbedded
}
