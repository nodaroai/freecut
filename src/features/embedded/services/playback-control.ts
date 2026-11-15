import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineViewportStore } from '../deps/timeline-contract'
import { openSequence } from './open-sequence'

/**
 * NODARO_PLAYBACK { action: 'seek' | 'play' | 'pause', frame? }: move the
 * playhead or start and stop playback, so a parent that edits the timeline can
 * show the person where each change landed and play the result. A frame the
 * timeline is not showing is scrolled into view, so the person sees the change
 * as it lands. No reply.
 *
 * `{ action: 'open-sequence', sequenceId }` opens a timeline tab (see `openSequence`).
 */
export function handlePlayback(event: MessageEvent): void {
  const payload = (event.data?.payload ?? {}) as Record<string, unknown>
  const { action, frame } = payload
  if (action === 'open-sequence') {
    openSequence(payload.sequenceId)
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
