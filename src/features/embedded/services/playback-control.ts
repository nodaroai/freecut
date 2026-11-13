import { usePlaybackStore } from '@/shared/state/playback'

/**
 * NODARO_PLAYBACK { action: 'seek' | 'play' | 'pause', frame? }: move the
 * playhead or start and stop playback, so a parent that edits the timeline can
 * show the person where each change landed and play the result. No reply.
 */
export function handlePlayback(event: MessageEvent): void {
  const { action, frame } = (event.data?.payload ?? {}) as { action?: unknown; frame?: unknown }
  const playback = usePlaybackStore.getState()
  if (typeof frame === 'number' && Number.isFinite(frame)) {
    playback.setCurrentFrame(Math.max(0, Math.round(frame)))
  }
  if (action === 'play') playback.play()
  else if (action === 'pause') playback.pause()
}
