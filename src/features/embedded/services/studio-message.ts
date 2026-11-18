import { useStudioStore } from '../stores/studio-store'

const MAX_SIDE_WIDTH = 640

/**
 * NODARO_STUDIO { sideOpen, sideWidth, sideLabel }: turn on the studio layout
 * and say whether the parent's side panel is open and how wide a slot it needs.
 */
export function handleStudio(event: MessageEvent): void {
  const payload = (event.data?.payload ?? {}) as Record<string, unknown>
  const width =
    typeof payload.sideWidth === 'number' && Number.isFinite(payload.sideWidth)
      ? payload.sideWidth
      : 0
  useStudioStore.getState().setStudio({
    sideOpen: payload.sideOpen === true,
    sideWidth: Math.max(0, Math.min(MAX_SIDE_WIDTH, Math.round(width))),
    sideLabel: typeof payload.sideLabel === 'string' ? payload.sideLabel.slice(0, 40) : '',
    origin: event.origin,
  })
}

/** Tell the parent something from the studio layout (a rect, a button pressed). */
export function postToParent(type: string, payload: Record<string, unknown>): void {
  const origin = useStudioStore.getState().origin
  if (!origin || window.parent === window) return
  window.parent.postMessage({ type, payload }, origin)
}
