import { create } from 'zustand';

interface InputMetadata {
  codec: string;
  width: number;
  height: number;
  fps: number;
}

interface EmbeddedState {
  isEmbedded: boolean;
  isImporting: boolean;
  parentOrigin: string | null;
  inputMetadata: InputMetadata | null;
  pendingVideoImport: { mediaId: string } | null;
  sendBackStatus: 'idle' | 'exporting' | 'sent' | 'error';
  exportProgress: number;
}

interface EmbeddedActions {
  setIsImporting: (v: boolean) => void;
  setParentOrigin: (origin: string) => void;
  setInputMetadata: (meta: InputMetadata) => void;
  setPendingVideoImport: (pending: { mediaId: string } | null) => void;
  setSendBackStatus: (status: EmbeddedState['sendBackStatus']) => void;
  setExportProgress: (progress: number) => void;
}

function detectEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export const useEmbeddedStore = create<EmbeddedState & EmbeddedActions>((set) => ({
  isEmbedded: detectEmbedded(),
  isImporting: false,
  parentOrigin: null,
  inputMetadata: null,
  pendingVideoImport: null,
  sendBackStatus: 'idle',
  exportProgress: 0,

  setIsImporting: (isImporting) => set({ isImporting }),
  setParentOrigin: (parentOrigin) => set({ parentOrigin }),
  setInputMetadata: (inputMetadata) => set({ inputMetadata }),
  setPendingVideoImport: (pendingVideoImport) => set({ pendingVideoImport }),
  setSendBackStatus: (sendBackStatus) => set({ sendBackStatus }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
}));

export function isEmbedded(): boolean {
  return useEmbeddedStore.getState().isEmbedded;
}
