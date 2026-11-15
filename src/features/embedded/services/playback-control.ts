import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineViewportStore } from '../deps/timeline-contract'
import { COMPARE_MODES, useCompareStore, type CompareMode } from '../stores/compare-store'
import { openSequence } from './open-sequence'

/** `{ action: 'compare', mode, split? }`: what the program monitor shows (see `CompareMode`). */
function compare(payload: Record<string, unknown>): void {
  const { mode, split } = payload
  if (typeof mode !== 'string' || !COMPARE_MODES.includes(mode as CompareMode)) return
  const at = typeof split === 'number' && Number.isFinite(split) ? split : undefined
  useCompareStore.getState().setMode(mode as CompareMode, at)
}

/**
 * NODARO_PLAYBACK { action: 'seek' | 'play' | 'pause', frame? }: move the
 * playhead or start and stop playback, so a parent that edits the timeline can
 * show the person where each change landed and play the result. A frame the
 * timeline is not showing is scrolled into view, so the person sees the change
 * as it lands. No reply.
 *
 * - `{ action: 'open-sequence', sequenceId }` opens a timeline tab (see `openSequence`).
 * - `{ action: 'compare', mode: 'program' | 'source' | 'split', split? }` shows
 *   the edit, the original, or the original beside the edit (see `CompareOverlay`).
 */
export function handlePlayback(event: MessageEvent): void {
  const payload = (event.data?.payload ?? {}) as Record<string, unknown>
  const { action, frame } = payload
  if (action === 'open-sequence') {
    openSequence(payload.sequenceId)
    return
  }
  if (action === 'compare') {
    compare(payload)
    return
  }
  const playback = usePlaybackStore.getState()
  if (typeof frame === 'number' && Number.isFinite(frame)) {
    const at = Math.max(0, Math.round(frame))
    playback.setCurrentFrame(at)
    useTimelineViewportStore.getState().requestScrollToFrame(at)
  }
  if (action === 'play') playback.play()
  else if (action === 'pause') playback.pause()
}
