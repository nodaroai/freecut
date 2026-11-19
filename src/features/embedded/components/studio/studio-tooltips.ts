/**
 * The timeline's toolbar sits right under the work row, where the parent lays
 * its side panel over the editor. A tooltip opening upward from it would go
 * under that panel and could not be read, so in the studio the toolbar's
 * tooltips open downward. Only `data-tooltip-side` is written, on buttons
 * that do not name a side of their own; nothing upstream changes.
 */
const BAR = '[data-editor-pane="timeline"] > :first-child'

/** Set the toolbar's unnamed tooltips to open below; returns how many it set. */
export function tooltipsBelow(root: ParentNode = document): number {
  const bar = root.querySelector(BAR)
  if (!bar) return 0
  let set = 0
  for (const el of bar.querySelectorAll('[data-tooltip]:not([data-tooltip-side])')) {
    el.setAttribute('data-tooltip-side', 'bottom')
    set += 1
  }
  return set
}

/** Keep the toolbar's tooltips opening below while the editor redraws it; returns the stop. */
export function keepTooltipsBelow(): () => void {
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      tooltipsBelow()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  tooltipsBelow()
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
