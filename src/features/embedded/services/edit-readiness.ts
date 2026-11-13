import { useTimelineSettingsStore } from '../deps/timeline-contract'
import { useProjectStore } from '../deps/projects-contract'
import { useEmbeddedStore } from '../stores/embedded-store'

/** How long an edit request waits for the editor to be free before it is refused. */
const READY_TIMEOUT_MS = 15_000
const POLL_MS = 100

// Pointers held down in the editor. A drag records its own history entry when
// it ends, from a snapshot taken when it began; a parent's edit landing between
// the two would be folded into the drag's undo, so edits wait for the pointer.
const pressed = new Set<number>()
let watching = false

function watchPointers(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener('pointerdown', (e) => pressed.add(e.pointerId), true)
  const release = (e: PointerEvent) => pressed.delete(e.pointerId)
  document.addEventListener('pointerup', release, true)
  document.addEventListener('pointercancel', release, true)
  window.addEventListener('blur', () => pressed.clear())
}

/** Why the editor cannot take an edit right now, or null when it can. */
export function editBlocker(): string | null {
  if (!useProjectStore.getState().currentProject?.id) return 'No project is open'
  if (useTimelineSettingsStore.getState().isTimelineLoading) return 'The timeline is still loading'
  const embedded = useEmbeddedStore.getState()
  if (embedded.isImporting || embedded.pendingVideoImport)
    return 'The video is still being imported'
  if (pressed.size > 0) return 'The person is dragging on the timeline'
  return null
}

/**
 * Wait until the editor can take an edit: a project is open, its timeline is
 * loaded, no import is running and no pointer is held down. Answers the open
 * project's id; refuses with the reason when it is still busy after a while.
 */
export async function waitUntilEditable(timeoutMs = READY_TIMEOUT_MS): Promise<string> {
  watchPointers()
  const end = Date.now() + timeoutMs
  for (;;) {
    const blocker = editBlocker()
    const projectId = useProjectStore.getState().currentProject?.id
    if (!blocker && projectId) return projectId
    // A missing project will not appear by waiting; anything else may clear.
    if (!projectId || Date.now() >= end) throw new Error(blocker ?? 'No project is open')
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
