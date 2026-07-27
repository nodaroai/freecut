import { memo, useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { usePlaybackStore } from '@/shared/state/playback'
import { beginIoPointerDrag } from '@/shared/timeline/io-range'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { pixelsToFrameNow } from '../utils/zoom-conversions'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'

// Matches the ruler's top IO lane height in timeline-markers.tsx.
const IO_LANE_HEIGHT = 12
const GRIP_WIDTH = 8
const GRIP_GAP = 3
const GRIP_HIT_WIDTH = 16

interface PlayheadRangeGripsProps {
  maxFrame?: number
  rulerRef: RefObject<HTMLDivElement | null>
}

/**
 * Camtasia-style range grips riding on the playhead: a green grip on its left
 * and a red one on its right, living in the ruler's IO lane (the playhead flag
 * sits below the lane, so nothing overlaps). Dragging either grip marks an
 * in/out range anchored at the playhead — no keyboard or toolbar needed. Once
 * a range exists the grips step aside and the regular in/out markers (which
 * are draggable themselves) own the lane; clearing the range brings them back.
 */
export const PlayheadRangeGrips = memo(function PlayheadRangeGrips({
  maxFrame,
  rulerRef,
}: PlayheadRangeGripsProps) {
  const { t } = useTranslation()
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const fps = useTimelineStore((s) => s.fps)
  const { frameToPixels } = useTimelineZoomContext()

  const wrapperRef = useRef<HTMLDivElement>(null)
  const frameToPixelsRef = useRef(frameToPixels)
  const setInPointRef = useRef(setInPoint)
  const setOutPointRef = useRef(setOutPoint)
  const maxFrameRef = useRef(maxFrame)
  const fpsRef = useRef(fps)
  frameToPixelsRef.current = frameToPixels
  setInPointRef.current = setInPoint
  setOutPointRef.current = setOutPoint
  maxFrameRef.current = maxFrame
  fpsRef.current = fps

  const dragCleanupRef = useRef<(() => void) | null>(null)
  const hasRange = inPoint !== null || outPoint !== null

  // Follow the playhead without re-rendering (same pattern as TimelinePlayhead).
  useEffect(() => {
    if (hasRange) return

    const updatePosition = (frame: number) => {
      if (!wrapperRef.current) return
      const transform = `translate3d(${Math.round(frameToPixelsRef.current(frame))}px, 0, 0)`
      if (wrapperRef.current.style.transform !== transform) {
        wrapperRef.current.style.transform = transform
      }
    }

    updatePosition(usePlaybackStore.getState().currentFrame)
    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame ?? state.currentFrame)
    })
  }, [hasRange])

  // Reposition when zoom changes.
  useLayoutEffect(() => {
    if (hasRange || !wrapperRef.current) return
    const frame = usePlaybackStore.getState().currentFrame
    wrapperRef.current.style.transform = `translate3d(${Math.round(frameToPixels(frame))}px, 0, 0)`
  }, [frameToPixels, hasRange])

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      const ruler = rulerRef.current
      if (!ruler) return

      const anchorFrame = Math.max(0, usePlaybackStore.getState().currentFrame)
      const prevCursor = document.body.style.cursor
      const cleanup = beginIoPointerDrag(
        event,
        (clientX) => {
          const rect = ruler.getBoundingClientRect()
          let frame = Math.max(0, Math.round(pixelsToFrameNow(clientX - rect.left)))
          if (maxFrameRef.current !== undefined) {
            frame = Math.min(frame, maxFrameRef.current)
          }
          // A press without movement marks nothing — the range appears once the
          // pointer actually leaves the anchor frame. Out is set first so the
          // in <= out sanitizer never has to intervene mid-drag.
          if (frame !== anchorFrame) {
            setOutPointRef.current(Math.max(frame, anchorFrame))
            setInPointRef.current(Math.min(frame, anchorFrame))
          }
          usePlaybackStore.getState().setPreviewFrame(frame)
          return formatTimecodeCompact(frame, fpsRef.current)
        },
        () => {
          document.body.style.cursor = prevCursor
          previewScrubberSuppressRef.current = false
          usePlaybackStore.getState().setPreviewFrame(null)
          dragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'col-resize'
      previewScrubberSuppressRef.current = true
      dragCleanupRef.current = cleanup
    },
    [rulerRef],
  )

  useEffect(
    () => () => {
      dragCleanupRef.current?.()
    },
    [],
  )

  if (hasRange) {
    return null
  }

  return (
    <div
      ref={wrapperRef}
      className="absolute top-0"
      style={{ height: IO_LANE_HEIGHT, pointerEvents: 'none', zIndex: 9998 }}
    >
      {/* Green in-grip on the playhead's left. */}
      <div
        title={t('timeline.header.setInPointTooltip')}
        className="absolute pointer-events-auto"
        style={{
          top: 0,
          left: -(GRIP_GAP + GRIP_HIT_WIDTH),
          width: GRIP_HIT_WIDTH,
          height: IO_LANE_HEIGHT + 4,
          cursor: 'col-resize',
        }}
        onPointerDown={startDrag}
      >
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: 1,
            right: 0,
            width: GRIP_WIDTH,
            height: IO_LANE_HEIGHT - 2,
            borderRadius: '5px 1px 1px 5px',
            background:
              'linear-gradient(to bottom, color-mix(in oklch, var(--color-timeline-in) 95%, white), color-mix(in oklch, var(--color-timeline-in) 75%, black))',
            boxShadow: '0 0 2px color-mix(in oklch, var(--color-timeline-in) 55%, transparent)',
          }}
        />
      </div>

      {/* Red out-grip on the playhead's right. */}
      <div
        title={t('timeline.header.setOutPointTooltip')}
        className="absolute pointer-events-auto"
        style={{
          top: 0,
          left: GRIP_GAP,
          width: GRIP_HIT_WIDTH,
          height: IO_LANE_HEIGHT + 4,
          cursor: 'col-resize',
        }}
        onPointerDown={startDrag}
      >
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            top: 1,
            left: 0,
            width: GRIP_WIDTH,
            height: IO_LANE_HEIGHT - 2,
            borderRadius: '1px 5px 5px 1px',
            background:
              'linear-gradient(to bottom, color-mix(in oklch, var(--color-timeline-out) 95%, white), color-mix(in oklch, var(--color-timeline-out) 75%, black))',
            boxShadow: '0 0 2px color-mix(in oklch, var(--color-timeline-out) 55%, transparent)',
          }}
        />
      </div>
    </div>
  )
})
