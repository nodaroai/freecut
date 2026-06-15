/**
 * Self-positioning playhead line for the dopesheet timeline.
 *
 * During scrubbing/seeking the editor re-renders (cheap, RAF-coalesced) and the
 * `relativeFrame` prop drives the position. During *playback* the editor is
 * deliberately kept out of the hot path (it does not re-render per frame), so
 * this component subscribes to the playback store directly and moves the line by
 * writing `style.left` on a ref — no React re-render of the editor — keeping
 * playback smooth while the playhead still tracks it.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'

interface DopesheetPlayheadLineProps {
  /** Clip-relative playhead frame for the paused/seek/zoom (React-driven) case. */
  relativeFrame: number
  /** Absolute timeline frame where the edited item starts (for abs→relative). */
  itemFrom: number
  /** Item duration in frames (clip-relative clamp bound). */
  totalFrames: number
  /** Clip-relative frame → x within the timeline viewport. */
  frameToX: (frame: number) => number
  /** Upper clamp for `left` (keeps the line inside the viewport). */
  maxLeft: number
  className?: string
}

export function DopesheetPlayheadLine({
  relativeFrame,
  itemFrom,
  totalFrames,
  frameToX,
  maxLeft,
  className,
}: DopesheetPlayheadLineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const clampLeft = (frame: number): number => Math.max(0, Math.min(maxLeft, frameToX(frame)))

  // Paused / seek / zoom: position from the React-driven relative frame. Runs on
  // every editor render (which only happens when not playing in the hot path).
  useLayoutEffect(() => {
    if (ref.current) ref.current.style.left = `${clampLeft(relativeFrame)}px`
  })

  // Playback and active editor scrubs: move via direct DOM on each store frame
  // change (no editor render). React reconciles to the final frame when the
  // scrub preview clears.
  useEffect(() => {
    const update = () => {
      const state = usePlaybackStore.getState()
      const isPreviewing = state.previewFrame !== null
      if (!state.isPlaying && !isPreviewing) return
      const lastFrame = Math.max(0, (totalFrames || 1) - 1)
      const frame = state.previewFrame ?? state.currentFrame
      const rel = Math.max(0, Math.min(lastFrame, frame - itemFrom))
      if (ref.current) ref.current.style.left = `${clampLeft(rel)}px`
    }
    return usePlaybackStore.subscribe(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFrom, totalFrames, frameToX, maxLeft])

  return <div ref={ref} data-testid="dopesheet-playhead-line" className={className} />
}
