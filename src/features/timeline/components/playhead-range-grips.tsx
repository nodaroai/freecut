import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { usePlaybackStore } from '@/shared/state/playback'
import { beginIoPointerDrag } from '@/shared/timeline/io-range'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { pixelsToFrameNow } from '../utils/zoom-conversions'

// Matches the ruler's top IO lane height in timeline-markers.tsx.
const IO_LANE_HEIGHT = 12
const FLAG_WIDTH = 15
const FLAG_HIT_WIDTH = 24
const FLAG_HIT_HEIGHT_EXTRA = 6

// Block the compatibility mousedown so the ruler's mouse-driven seek doesn't
// also fire when a flag is grabbed (same guard the shared IO markers use).
function blockMouseDown(e: { preventDefault: () => void; stopPropagation: () => void }) {
  e.preventDefault()
  e.stopPropagation()
}

interface PlayheadRangeGripsProps {
  maxFrame?: number
  rulerRef: React.RefObject<HTMLDivElement | null>
}

interface RangeFlagProps {
  side: 'in' | 'out'
  title: string
  onDragStart: (e: React.PointerEvent) => void
  onClear: () => void
}

/** One chunky Camtasia-style flag: green hugs the point from the left, red from the right. */
function RangeFlag({ side, title, onDragStart, onClear }: RangeFlagProps) {
  const color = side === 'in' ? 'var(--color-timeline-in)' : 'var(--color-timeline-out)'
  return (
    <div
      title={title}
      className="absolute pointer-events-auto"
      style={{
        top: 0,
        left: side === 'in' ? -FLAG_HIT_WIDTH + (FLAG_HIT_WIDTH - FLAG_WIDTH) / 2 : 0,
        width: FLAG_HIT_WIDTH,
        height: IO_LANE_HEIGHT + FLAG_HIT_HEIGHT_EXTRA,
        cursor: 'col-resize',
        zIndex: side === 'in' ? 2 : 1,
      }}
      onPointerDown={onDragStart}
      onMouseDown={blockMouseDown}
      onDoubleClick={onClear}
    >
      <div
        aria-hidden="true"
        className="absolute"
        style={{
          top: 0,
          [side === 'in' ? 'right' : 'left']: (FLAG_HIT_WIDTH - FLAG_WIDTH) / 2,
          width: FLAG_WIDTH,
          height: IO_LANE_HEIGHT,
          borderRadius: side === 'in' ? '5px 1px 1px 5px' : '1px 5px 5px 1px',
          background: `linear-gradient(to bottom, color-mix(in oklch, ${color} 92%, white), color-mix(in oklch, ${color} 72%, black))`,
          boxShadow: `inset 0 1px 0 color-mix(in oklch, white 35%, transparent), 0 0 3px color-mix(in oklch, ${color} 60%, transparent)`,
        }}
      />
    </div>
  )
}

/**
 * Camtasia-style range flags: a big green flag and a big red flag that ARE the
 * in/out points. With no range marked they ride the playhead as its two-colored
 * head; dragging one pulls that side away while the other stays anchored — the
 * preview ghost line travels with the dragged flag so you see the frame you are
 * extending over. Once a range exists the flags sit on its edges and each can
 * be re-dragged; double-click a flag (or the toolbar X) clears the range and
 * docks them back on the playhead.
 */
export const PlayheadRangeGrips = memo(function PlayheadRangeGrips({
  maxFrame,
  rulerRef,
}: PlayheadRangeGripsProps) {
  const { t } = useTranslation()
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const { frameToPixels } = useTimelineZoomContext()

  const dockedWrapperRef = useRef<HTMLDivElement>(null)
  const frameToPixelsRef = useRef(frameToPixels)
  const maxFrameRef = useRef(maxFrame)
  frameToPixelsRef.current = frameToPixels
  maxFrameRef.current = maxFrame

  const dragCleanupRef = useRef<(() => void) | null>(null)
  const isDocked = inPoint === null && outPoint === null

  // Docked mode follows the playhead without re-rendering (same pattern as
  // TimelinePlayhead). With a range marked the flags are laid out from the
  // store values instead and this subscription stays off.
  useEffect(() => {
    if (!isDocked) return

    const updatePosition = (frame: number) => {
      if (!dockedWrapperRef.current) return
      const transform = `translate3d(${Math.round(frameToPixelsRef.current(frame))}px, 0, 0)`
      if (dockedWrapperRef.current.style.transform !== transform) {
        dockedWrapperRef.current.style.transform = transform
      }
    }

    updatePosition(usePlaybackStore.getState().currentFrame)
    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame ?? state.currentFrame)
    })
  }, [isDocked])

  useLayoutEffect(() => {
    if (!isDocked || !dockedWrapperRef.current) return
    const frame = usePlaybackStore.getState().currentFrame
    dockedWrapperRef.current.style.transform = `translate3d(${Math.round(frameToPixels(frame))}px, 0, 0)`
  }, [frameToPixels, isDocked])

  const startDrag = useCallback(
    (side: 'in' | 'out') => (event: React.PointerEvent) => {
      const ruler = rulerRef.current
      if (!ruler) return

      const timeline = useTimelineStore.getState()
      const playheadFrame = Math.max(0, usePlaybackStore.getState().currentFrame)
      // The opposite side stays anchored: at its marked point, or at the
      // playhead when starting from the docked state.
      const anchorFrame =
        side === 'in' ? (timeline.outPoint ?? playheadFrame) : (timeline.inPoint ?? playheadFrame)

      const cleanup = beginIoPointerDrag(
        event,
        (clientX) => {
          const rect = ruler.getBoundingClientRect()
          let frame = Math.max(0, Math.round(pixelsToFrameNow(clientX - rect.left)))
          if (maxFrameRef.current !== undefined) {
            frame = Math.min(frame, maxFrameRef.current)
          }
          // Out first so the in <= out sanitizer never has to intervene.
          if (frame !== anchorFrame) {
            const store = useTimelineStore.getState()
            store.setOutPoint(Math.max(frame, anchorFrame))
            store.setInPoint(Math.min(frame, anchorFrame))
          }
          // The preview ghost line travels with the dragged flag (deliberately
          // not suppressed) — Camtasia's "the flag moves with the time".
          usePlaybackStore.getState().setPreviewFrame(frame)
          return formatTimecodeCompact(frame, useTimelineStore.getState().fps)
        },
        () => {
          document.body.style.cursor = ''
          usePlaybackStore.getState().setPreviewFrame(null)
          dragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'col-resize'
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

  const handleInDragStart = useCallback((e: React.PointerEvent) => startDrag('in')(e), [startDrag])
  const handleOutDragStart = useCallback(
    (e: React.PointerEvent) => startDrag('out')(e),
    [startDrag],
  )

  const handleClear = useCallback(() => {
    useTimelineStore.getState().clearInOutPoints()
  }, [])

  const inFlag = (
    <RangeFlag
      side="in"
      title={t('timeline.header.setInPointTooltip')}
      onDragStart={handleInDragStart}
      onClear={handleClear}
    />
  )
  const outFlag = (
    <RangeFlag
      side="out"
      title={t('timeline.header.setOutPointTooltip')}
      onDragStart={handleOutDragStart}
      onClear={handleClear}
    />
  )

  if (isDocked) {
    return (
      <div
        ref={dockedWrapperRef}
        className="absolute top-0"
        style={{ height: IO_LANE_HEIGHT, pointerEvents: 'none', zIndex: 9998 }}
      >
        {inFlag}
        {outFlag}
      </div>
    )
  }

  // Partial states (only I or only O pressed) collapse both flags onto the
  // point that exists, ready to be pulled apart.
  const inFrame = inPoint ?? outPoint ?? 0
  const outFrame = outPoint ?? inPoint ?? 0

  return (
    <div
      className="absolute top-0"
      style={{ height: IO_LANE_HEIGHT, pointerEvents: 'none', zIndex: 9998 }}
    >
      <div
        className="absolute top-0"
        style={{ left: Math.round(frameToPixels(inFrame)), height: IO_LANE_HEIGHT }}
      >
        {inFlag}
      </div>
      <div
        className="absolute top-0"
        style={{ left: Math.round(frameToPixels(outFrame)), height: IO_LANE_HEIGHT }}
      >
        {outFlag}
      </div>
    </div>
  )
})
