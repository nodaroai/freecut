import { useEmbeddedStore } from '../stores/embedded-store';

export function useEmbeddedMode() {
  return useEmbeddedStore((s) => s.isEmbedded);
}
