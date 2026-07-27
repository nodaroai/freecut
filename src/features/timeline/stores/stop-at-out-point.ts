import { usePlaybackStore } from '@/shared/state/playback'
import { useSettingsStore } from '../deps/settings'
import { useMarkersStore } from './markers-store'

/**
 * Pause playback when the playhead crosses the marked out point — the
 * Camtasia-style transport where the red handle is a hard stop. Runs as a
 * playback-store subscription so every frame driver (player loop, render
 * pump) is covered without touching any of them. Gated by the
 * `stopPlaybackAtOutPoint` setting; switching it off restores the stock
 * free-run behavior.
 *
 * Only a forward crossing stops: starting playback at or past the out point
 * plays on freely, and reverse shuttle is never interrupted.
 */
export function initStopAtOutPointSubscription(): () => void {
  return usePlaybackStore.subscribe((state, previousState) => {
    if (!state.isPlaying || state.playbackRate <= 0) {
      return
    }
    if (state.currentFrame === previousState.currentFrame) {
      return
    }
    if (!useSettingsStore.getState().stopPlaybackAtOutPoint) {
      return
    }

    const outPoint = useMarkersStore.getState().outPoint
    if (outPoint === null) {
      return
    }
    if (previousState.currentFrame >= outPoint || state.currentFrame < outPoint) {
      return
    }

    const playback = usePlaybackStore.getState()
    playback.pause()
    playback.setCurrentFrame(outPoint)
  })
}
