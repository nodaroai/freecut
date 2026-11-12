import { useEffect, useRef } from 'react'
import type { ExtendedExportSettings } from '@/types/export'
import { useClientRender } from '../deps/export-contract'

export interface SaveExitVideoRenderProps {
  readonly settings: ExtendedExportSettings
  /** The render's progress, 0..100. */
  readonly onProgress: (progress: number) => void
  readonly onRendered: (video: Blob) => void
  readonly onFailed: (message: string) => void
}

// The phases in which the render reports progress.
const RENDERING_PHASES = new Set(['preparing', 'rendering', 'encoding', 'finalizing'])

/**
 * Runs one Save & Exit render through the client render the export dialog
 * uses, and reports how it went. It is loaded on demand, only once a parent
 * asked for a video and Save & Exit was pressed, so the render engine stays
 * out of the editor's startup bundle. It draws nothing.
 *
 * Unmounting it releases the rendered file: read the video before unmounting.
 */
export function SaveExitVideoRender({
  settings,
  onProgress,
  onRendered,
  onFailed,
}: SaveExitVideoRenderProps) {
  const { startExport, progress, status, result, error } = useClientRender()
  const started = useRef(false)
  const settled = useRef(false)

  // One render per mount: the ref keeps StrictMode's second effect pass from
  // starting another.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void startExport(settings)
  }, [settings, startExport])

  useEffect(() => {
    if (!settled.current && RENDERING_PHASES.has(status)) onProgress(progress)
  }, [status, progress, onProgress])

  // Settles exactly once. Nothing here cancels the render, but a cancelled
  // render still settles, so the button never waits forever.
  useEffect(() => {
    if (settled.current) return
    if (status === 'completed' && result) {
      settled.current = true
      onRendered(result.blob)
    } else if (status === 'failed' || status === 'cancelled') {
      settled.current = true
      onFailed(status === 'cancelled' ? 'The render was cancelled' : (error ?? 'The render failed'))
    }
  }, [status, result, error, onRendered, onFailed])

  return null
}
