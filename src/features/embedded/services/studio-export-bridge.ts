import { useProjectStore } from '../deps/projects-contract'
import { exportProjectJson } from '../deps/project-bundle-contract'
import { isEmbedded, useEmbeddedStore } from '../stores/embedded-store'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('Embedded:StudioExportBridge')

/**
 * Flush the timeline to storage and serialize the current project. Best-effort:
 * any failure degrades to `null` so callers can still hand the video (or the
 * exit) to the studio without layers to restore.
 */
export async function collectProjectJson(): Promise<unknown> {
  try {
    const currentProject = useProjectStore.getState().currentProject
    if (!currentProject) return null
    const { useTimelineStore } = await import('../deps/timeline-contract')
    await useTimelineStore.getState().saveTimeline(currentProject.id)
    return await exportProjectJson(currentProject.id, {
      includeMediaReferences: true,
      stripVolatileFields: true,
      includeChecksum: false,
    })
  } catch (e) {
    log.warn('Failed to serialize the project JSON for the studio', { error: e })
    return null
  }
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
