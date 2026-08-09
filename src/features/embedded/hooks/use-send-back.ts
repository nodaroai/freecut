import { useCallback } from 'react'
import { useProjectStore } from '../deps/projects-contract'
import { exportProjectJson } from '../deps/project-bundle-contract'
import { useEmbeddedStore } from '../stores/embedded-store'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('Embedded:SaveExit')

/**
 * Save & Exit for the embedded editor: persists the timeline, hands the
 * project JSON to the parent studio via FREECUT_SAVE_EXIT, and lets the
 * parent close the editor. No video is rendered here — explicit exports go
 * through the export dialog (the toolbar's Export button) instead.
 */
export function useSendBack() {
  const parentOrigin = useEmbeddedStore((s) => s.parentOrigin)
  const sendBackStatus = useEmbeddedStore((s) => s.sendBackStatus)

  const saveExit = useCallback(async () => {
    if (!parentOrigin) {
      log.warn('saveExit called before the parent handshake set an origin')
      return
    }

    useEmbeddedStore.getState().setSendBackStatus('saving')

    // Flush the timeline to storage, then serialize the project. Failures
    // degrade to exiting without JSON — the parent still closes the editor.
    let projectJson: unknown = null
    try {
      const currentProject = useProjectStore.getState().currentProject
      if (currentProject) {
        const { useTimelineStore } = await import('../deps/timeline-contract')
        await useTimelineStore.getState().saveTimeline(currentProject.id)
        projectJson = await exportProjectJson(currentProject.id, {
          includeMediaReferences: true,
          stripVolatileFields: true,
          includeChecksum: false,
        })
      }
    } catch (e) {
      log.warn('Failed to export project JSON for save-exit', { error: e })
    }

    window.parent.postMessage({ type: 'FREECUT_SAVE_EXIT', payload: { projectJson } }, parentOrigin)
    log.info('Save-exit sent to parent', { hasProjectJson: !!projectJson })
    useEmbeddedStore.getState().setSendBackStatus('sent')
    setTimeout(() => {
      useEmbeddedStore.getState().setSendBackStatus('idle')
    }, 3000)
  }, [parentOrigin])

  return {
    saveExit,
    isSaving: sendBackStatus === 'saving',
    sendBackStatus,
  }
}
