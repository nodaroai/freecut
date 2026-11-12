import { createElement, useCallback, useState, type ComponentType } from 'react'
import type { SaveExitVideoRenderProps } from '../components/save-exit-video-render'
import { useProjectStore } from '../deps/projects-contract'
import { collectProjectJson } from '../services/studio-export-bridge'
import { useEmbeddedStore } from '../stores/embedded-store'
import { reverseMapCodec } from '../utils/codec-mapping'
import { createLogger } from '@/shared/logging/logger'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { ExtendedExportSettings } from '@/types/export'

const log = createLogger('Embedded:SaveExit')

interface VideoRender {
  readonly Render: ComponentType<SaveExitVideoRenderProps>
  readonly props: SaveExitVideoRenderProps
}

/** Shows 'sent' for a moment once the parent has what it asked for, then 'idle'. */
function markSent() {
  useEmbeddedStore.getState().setSendBackStatus('sent')
  setTimeout(() => {
    useEmbeddedStore.getState().setSendBackStatus('idle')
  }, 3000)
}

/**
 * The render a video Save & Exit sends, made as the editor's render-on-close
 * always made it: the source video's codec and frame size, high quality, the
 * whole timeline (in/out points ignored), MP4. A project with no source video
 * (an empty boot) is rendered at its own frame size, in H.264. The frame rate
 * is the timeline's, as in every export.
 */
function saveExitRenderSettings(): ExtendedExportSettings {
  const source = useEmbeddedStore.getState().inputMetadata
  const project = useProjectStore.getState().currentProject?.metadata
  const frame = source ??
    project ?? { width: DEFAULT_PROJECT_WIDTH, height: DEFAULT_PROJECT_HEIGHT }
  return {
    codec: reverseMapCodec(source?.codec ?? ''),
    quality: 'high',
    resolution: { width: frame.width, height: frame.height },
    mode: 'video',
    videoContainer: 'mp4',
    renderWholeProject: true,
  }
}

/** The project JSON alone, in FREECUT_SAVE_EXIT; no video is rendered. */
async function saveProject(parentOrigin: string) {
  useEmbeddedStore.getState().setSendBackStatus('saving')

  // Serialization failures degrade to exiting without JSON — the parent
  // still closes the editor.
  const projectJson = await collectProjectJson()

  window.parent.postMessage({ type: 'FREECUT_SAVE_EXIT', payload: { projectJson } }, parentOrigin)
  log.info('Save-exit sent to parent', { hasProjectJson: !!projectJson })
  markSent()
}

/**
 * Save & Exit for the embedded editor. It saves the timeline and hands the
 * parent what NODARO_LOAD_VIDEO's `saveExit` asked for; the parent then closes
 * the editor:
 * - `project` (the default): the project JSON alone, in FREECUT_SAVE_EXIT.
 * - `video`: the whole timeline rendered (see saveExitRenderSettings) and the
 *   project JSON, in FREECUT_EXPORT_COMPLETE, with FREECUT_EXPORT_PROGRESS while
 *   it renders and FREECUT_ERROR { phase: 'export' } if it fails.
 * Explicit exports go through the export dialog (the toolbar's Export button).
 *
 * `renderer` runs a video Save & Exit's render. Mount it beside whatever uses
 * this hook; it draws nothing, and it is null while no render runs.
 */
export function useSendBack() {
  const parentOrigin = useEmbeddedStore((s) => s.parentOrigin)
  const sendBackStatus = useEmbeddedStore((s) => s.sendBackStatus)
  const [render, setRender] = useState<VideoRender | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const saveVideo = useCallback(async (origin: string) => {
    const store = useEmbeddedStore.getState()
    if (store.sendBackStatus === 'saving') return // one render at a time
    store.setSendBackStatus('saving')

    try {
      // Save and serialize first, so the JSON describes the timeline the render reads.
      const projectJson = await collectProjectJson()
      const settings = saveExitRenderSettings()
      // Loaded on demand: the render engine stays out of the editor's startup bundle.
      const { SaveExitVideoRender } = await import('../components/save-exit-video-render')
      log.info('Rendering the timeline for Save & Exit', {
        codec: settings.codec,
        resolution: `${settings.resolution.width}x${settings.resolution.height}`,
      })
      setProgress(0)
      const video = await new Promise<Blob>((resolve, reject) => {
        setRender({
          Render: SaveExitVideoRender,
          props: {
            settings,
            onProgress: (value) => {
              setProgress(value)
              window.parent.postMessage(
                { type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: value / 100 } },
                origin,
              )
            },
            onRendered: resolve,
            onFailed: (message) => reject(new Error(message)),
          },
        })
      })
      // Read the bytes while the renderer is mounted: unmounting releases the file.
      const videoBuffer = await video.arrayBuffer()
      window.parent.postMessage(
        { type: 'FREECUT_EXPORT_COMPLETE', payload: { videoBuffer, projectJson } },
        origin,
        [videoBuffer],
      )
      log.info('Save & Exit video sent to parent', {
        bytes: video.size,
        hasProjectJson: !!projectJson,
      })
      markSent()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Save & Exit could not render the video'
      window.parent.postMessage(
        { type: 'FREECUT_ERROR', payload: { phase: 'export', message } },
        origin,
      )
      log.error('Save & Exit render failed', { error: message })
      useEmbeddedStore.getState().setSendBackStatus('error')
    } finally {
      setRender(null)
      setProgress(null)
    }
  }, [])

  const saveExit = useCallback(async () => {
    if (!parentOrigin) {
      log.warn('saveExit called before the parent handshake set an origin')
      return
    }
    if (useEmbeddedStore.getState().saveExitMode === 'video') {
      await saveVideo(parentOrigin)
    } else {
      await saveProject(parentOrigin)
    }
  }, [parentOrigin, saveVideo])

  return {
    saveExit,
    isSaving: sendBackStatus === 'saving',
    sendBackStatus,
    /** The render's progress, 0..100, while a video Save & Exit renders; else null. */
    progress,
    renderer: render && createElement(render.Render, render.props),
  }
}
