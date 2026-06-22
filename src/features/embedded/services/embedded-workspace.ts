import { getWorkspaceRoot, setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { bootstrapWorkspace } from '@/infrastructure/storage/workspace-fs/bootstrap'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('embedded-workspace')

let mountPromise: Promise<void> | null = null

/**
 * Mount the browser's OPFS root as the FreeCut workspace when running embedded.
 *
 * Upstream's workspace-FS storage requires an active FileSystemDirectoryHandle,
 * normally chosen by the user through WorkspaceGate's folder picker. An embedded
 * iframe cannot show that picker, so we mount OPFS instead — it exposes the same
 * handle type via `navigator.storage.getDirectory()`, needs no user gesture, and
 * is origin-private, matching the pre-sync IndexedDB persistence model.
 *
 * Idempotent: the first call performs the mount; concurrent and later callers
 * await the same promise. The root is published via `setWorkspaceRoot` only after
 * `bootstrapWorkspace` finishes, so no storage op ever sees a half-initialized
 * workspace.
 */
export function ensureEmbeddedWorkspaceMounted(): Promise<void> {
  if (mountPromise) return mountPromise
  mountPromise = (async () => {
    if (getWorkspaceRoot()) return
    const root = await navigator.storage.getDirectory()
    await bootstrapWorkspace(root)
    setWorkspaceRoot(root)
    log.info('Embedded workspace mounted on OPFS root')
  })()
  return mountPromise
}
