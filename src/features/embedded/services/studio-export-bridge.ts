import { exportProjectJson } from '../deps/project-bundle-contract'
import { isEmbedded, useEmbeddedStore } from '../stores/embedded-store'
import { shownProjectId, waitUntilProjectShown } from './held-project'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('Embedded:StudioExportBridge')

/**
 * Flush the timeline to storage and serialize the open project, once the
 * editor shows it fully loaded (waiting up to 10 s): saving at any other
 * moment would write what the live stores hold into the wrong project, or a
 * half-loaded one. Answers the project's id and file; null when the editor
 * does not show the open project in time, when none is open, or when
 * serializing fails, and then nothing is saved. `onSave` runs at the moment
 * the live stores are taken to be saved.
 */
export async function readProjectFile(onSave?: () => void): Promise<{
  projectId: string
  projectJson: unknown
} | null> {
  try {
    const { saveTimeline } = await import('../deps/timeline-contract')
    if (!(await waitUntilProjectShown())) return null
    // Checked again with no await before the save takes its snapshot.
    const projectId = shownProjectId()
    if (!projectId) return null
    onSave?.()
    await saveTimeline(projectId)
    const projectJson = await exportProjectJson(projectId, {
      includeMediaReferences: true,
      stripVolatileFields: true,
      includeChecksum: false,
    })
    return { projectId, projectJson }
  } catch (e) {
    log.warn('Failed to serialize the project JSON for the studio', { error: e })
    return null
  }
}

/**
 * The open project's file, as readProjectFile reads it. Best-effort: when it
 * cannot be read it is `null`, so callers can still hand the video (or the
 * exit) to the studio without layers to restore.
 */
export async function collectProjectJson(): Promise<unknown> {
  return (await readProjectFile())?.projectJson ?? null
}

/**
 * Hand a completed export-dialog render to the parent studio: posts
 * FREECUT_EXPORT_COMPLETE with `keepOpen`, so the studio saves it (a clip
 * variant / production cut / library upload, per flow) WITHOUT closing the
 * editor — the local download stays available in the dialog and the session
 * ends via Save & Exit. No-op (false) outside embedded mode or before the
 * parent handshake set an origin.
 */
export async function sendExportToStudio(blob: Blob): Promise<boolean> {
  const { parentOrigin } = useEmbeddedStore.getState()
  if (!isEmbedded() || !parentOrigin) return false

  const videoBuffer = await blob.arrayBuffer()
  const projectJson = await collectProjectJson()
  window.parent.postMessage(
    { type: 'FREECUT_EXPORT_COMPLETE', payload: { videoBuffer, projectJson, keepOpen: true } },
    parentOrigin,
    [videoBuffer],
  )
  log.info('Export handed to the studio', {
    bytes: blob.size,
    hasProjectJson: !!projectJson,
  })
  return true
}
