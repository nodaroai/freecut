/**
 * The work row takes most of the height in the studio (the timeline under it
 * still has room for eight lanes). The upstream split is resizable and saves
 * its own layout, so we move it once, the way a person would with the
 * keyboard, and after that leave it where the person puts it.
 */
const DONE_KEY = 'nodaro-studio:split-set'
const WORK_ROW_SHARE = 0.57

function topShare(group: Element): number | null {
  const top = group.firstElementChild
  const total = group.getBoundingClientRect().height
  if (!top || total <= 0) return null
  return top.getBoundingClientRect().height / total
}

/** Step the editor's split toward the studio's work row share; once per browser. */
export function settleSplitOnce(root: ParentNode = document): void {
  try {
    if (localStorage.getItem(DONE_KEY)) return
  } catch {
    return
  }
  const group = root.querySelector('[data-panel-group-direction="vertical"]')
  const handle = group
    ? [...group.children].find((child) => child.getAttribute('role') === 'separator')
    : null
  if (!group || !(handle instanceof HTMLElement)) return
  for (let step = 0; step < 6; step += 1) {
    const share = topShare(group)
    if (share === null || share >= WORK_ROW_SHARE - 0.05) break
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  }
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    // A browser that keeps nothing gets the split moved again next time: harmless.
  }
}
