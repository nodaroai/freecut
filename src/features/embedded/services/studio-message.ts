import { useStudioStore } from '../stores/studio-store'
import { parseHostButtons } from './studio-host-buttons'

const MAX_SIDE_WIDTH = 640

/**
 * NODARO_STUDIO { sideOpen, sideWidth, sideLabel, hostButtons? }: turn on the
 * studio layout, say whether the parent's side panel is open and how wide a
 * slot it needs, and which of its own buttons the top bar carries.
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
    hostButtons: parseHostButtons(payload.hostButtons),
    origin: event.origin,
  })
}

/** Tell the parent something from the studio layout (a rect, a button pressed). */
export function postToParent(type: string, payload: Record<string, unknown>): void {
  const origin = useStudioStore.getState().origin
  if (!origin || window.parent === window) return
  window.parent.postMessage({ type, payload }, origin)
}

/**
 * Tell the parent one of its own top-bar buttons was pressed, with where the
 * button is (CSS px in this frame) so it can anchor a popover under it.
 */
export function pressHostButton(id: string, button: Element): void {
  const { x, y, width, height } = button.getBoundingClientRect()
  postToParent('FREECUT_STUDIO_ACTION', {
    action: 'host-button',
    id,
    rect: { x, y, width, height },
  })
}
