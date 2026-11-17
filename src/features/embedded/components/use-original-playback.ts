import { useEffect } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { sourceSecondsAt, timelineFrameAt, type OriginalPiece } from '../services/compare-mapping'
import type { CompareMode } from '../stores/compare-store'

/** How far the original may drift from the edit while playing beside it, in seconds. */
const PLAYING_DRIFT = 0.25
/** How close a paused original is held to the playhead, in seconds. */
const PAUSED_DRIFT = 0.02
/** How often the playing original moves the playhead. */
const PLAYHEAD_EVERY_MS = 100

interface OriginalPlayback {
  readonly video: HTMLVideoElement | null
  readonly mode: CompareMode
  readonly pieces: readonly OriginalPiece[]
  readonly fps: number
}

const playheadFrame = () => {
  const { currentFrame, previewFrame } = usePlaybackStore.getState()
  return previewFrame ?? currentFrame
}

/** The monitor's own volume and mute, for the original's sound. */
function matchMonitorSound(video: HTMLVideoElement): void {
  const { volume, muted } = usePlaybackStore.getState()
  video.muted = muted
  video.volume = Math.min(1, Math.max(0, volume))
}

/**
 * 'source': the original is what plays. The transport's play/pause starts and
 * stops the original (the edit is held still under it), and the playing
 * original moves the playhead to the matching frame, waiting at a cut while it
 * plays what the edit removed. Moving the playhead seeks the original. Leaving
 * the mode puts the playhead at the moment the original was showing.
 */
function playOriginal(video: HTMLVideoElement, pieces: readonly OriginalPiece[], fps: number) {
  let playing = false
  let drivenFrame: number | null = null
  let drivenAt = 0
  const seekToPlayhead = () => {
    const target = sourceSecondsAt(playheadFrame(), pieces, fps)
    if (Math.abs(video.currentTime - target) > PAUSED_DRIFT) video.currentTime = target
  }
  const start = () => {
    playing = true
    matchMonitorSound(video)
    void video.play().catch(() => {
      playing = false
    })
  }
  const stop = () => {
    playing = false
    video.pause()
  }

  seekToPlayhead()
  // The edit was playing: the original carries on from the same moment.
  if (usePlaybackStore.getState().isPlaying) {
    usePlaybackStore.getState().pause()
    start()
  }
  const unsubscribe = usePlaybackStore.subscribe((state, previous) => {
    if (state.isPlaying && !previous.isPlaying) {
      state.pause()
      if (playing) stop()
      else start()
      return
    }
    const moved =
      state.currentFrame !== previous.currentFrame || state.previewFrame !== previous.previewFrame
    const ours = state.previewFrame === null && state.currentFrame === drivenFrame
    if (moved && !ours) seekToPlayhead()
  })
  const onEnded = () => {
    playing = false
  }
  video.addEventListener('ended', onEnded)

  let frameId = 0
  const tick = (now: number) => {
    if (playing && now - drivenAt >= PLAYHEAD_EVERY_MS) {
      drivenAt = now
      const { frame } = timelineFrameAt(video.currentTime, pieces, fps)
      if (frame !== usePlaybackStore.getState().currentFrame) {
        drivenFrame = frame
        usePlaybackStore.getState().setCurrentFrame(frame)
      }
    }
    frameId = requestAnimationFrame(tick)
  }
  frameId = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(frameId)
    unsubscribe()
    video.removeEventListener('ended', onEnded)
    video.pause()
    usePlaybackStore
      .getState()
      .setCurrentFrame(timelineFrameAt(video.currentTime, pieces, fps).frame)
  }
}

/**
 * 'split': the edit plays as always and the original follows the playhead,
 * silent, while playing and while scrubbing. A cut makes the original jump.
 */
function followPlayhead(video: HTMLVideoElement, pieces: readonly OriginalPiece[], fps: number) {
  video.muted = true
  let frameId = 0
  const tick = () => {
    const { isPlaying, previewFrame, playbackRate } = usePlaybackStore.getState()
    const target = sourceSecondsAt(playheadFrame(), pieces, fps)
    const playing = isPlaying && previewFrame === null && playbackRate > 0
    if (playing) {
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate
      if (video.paused) void video.play().catch(() => {})
      if (Math.abs(video.currentTime - target) > PLAYING_DRIFT) video.currentTime = target
    } else {
      if (!video.paused) video.pause()
      if (!video.seeking && Math.abs(video.currentTime - target) > PAUSED_DRIFT) {
        video.currentTime = target
      }
    }
    frameId = requestAnimationFrame(tick)
  }
  frameId = requestAnimationFrame(tick)
  return () => {
    cancelAnimationFrame(frameId)
    video.pause()
    video.playbackRate = 1
  }
}

/** Keeps the original video in step with the transport for the compare mode shown. */
export function useOriginalPlayback({ video, mode, pieces, fps }: OriginalPlayback): void {
  useEffect(() => {
    if (!video || pieces.length === 0 || mode === 'program') return
    return mode === 'source' ? playOriginal(video, pieces, fps) : followPlayhead(video, pieces, fps)
  }, [video, mode, pieces, fps])
}
