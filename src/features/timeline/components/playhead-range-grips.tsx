import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePlaybackStore } from '@/shared/state/playback'
import { beginIoPointerDrag } from '@/shared/timeline/io-range'
import { formatTimecodeCompact } from '@/shared/utils/time-utils'
import { useTimelineStore } from '../stores/timeline-store'
import {
  useTimelineCommittedZoomContext,
  useTimelineZoomContext,
} from '../contexts/timeline-zoom-context'
import { pixelsToFrameNow } from '../utils/zoom-conversions'

// Matches the ruler's top IO lane height in timeline-markers.tsx.
const IO_LANE_HEIGHT = 12
// Camtasia-proportioned flags: a wide body in the IO lane with a pointed foot
// that reaches down the ruler toward the exact frame.
const FLAG_WIDTH = 18
const FLAG_HEIGHT = 17
const FLAG_HIT_WIDTH = 26
const FLAG_HIT_HEIGHT = 24

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
  active: boolean
  onDragStart: (e: React.PointerEvent) => void
}

/**
 * One Camtasia-style pennant. The green one hangs left of its frame with the
 * pointed foot touching the line; the red one mirrors it on the right. The
 * flag being dragged brightens and glows so it's always obvious which side is
 * in hand.
 */
function RangeFlag({ side, title, active, onDragStart }: RangeFlagProps) {
  const color = side === 'in' ? 'var(--color-timeline-in)' : 'var(--color-timeline-out)'
  // Body fills the top ~60%; the foot slopes down to the frame-side edge.
  const shape =
    side === 'in'
      ? 'polygon(0 0, 100% 0, 100% 100%, 72% 60%, 0 60%)'
      : 'polygon(0 0, 100% 0, 100% 60%, 28% 60%, 0 100%)'

  return (
    <div
      title={title}
      data-range-flag={side}
      className="absolute pointer-events-auto"
      style={{
        top: 0,
        left: side === 'in' ? -FLAG_HIT_WIDTH + (FLAG_HIT_WIDTH - FLAG_WIDTH) / 2 : 0,
        width: FLAG_HIT_WIDTH,
        height: FLAG_HIT_HEIGHT,
        cursor: 'col-resize',
      }}
      onPointerDown={onDragStart}
      onMouseDown={blockMouseDown}
    >
      <div
        aria-hidden="true"
        className="absolute transition-[filter,transform] duration-100 hover:brightness-125"
        style={{
          top: 0,
          [side === 'in' ? 'right' : 'left']: (FLAG_HIT_WIDTH - FLAG_WIDTH) / 2,
          width: FLAG_WIDTH,
          height: FLAG_HEIGHT,
          filter: active
            ? `brightness(1.3) drop-shadow(0 0 4px ${color})`
            : 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.55))',
          transform: active ? 'scale(1.12)' : undefined,
          transformOrigin: side === 'in' ? 'bottom right' : 'bottom left',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            clipPath: shape,
            background: `linear-gradient(to bottom, color-mix(in oklch, ${color} 90%, white), ${color} 55%, color-mix(in oklch, ${color} 70%, black))`,
          }}
        />
      </div>
    </div>
  )
}

/**
 * Camtasia-style range flags: a green and a red pennant that ARE the in/out
 * points. With no range marked they ride the playhead as its two-colored head.
 * Dragging a flag pulls that side away while the other stays anchored, and the
 * real playhead line travels with the dragged flag — release the red and it
 * parks right beside it, green holding the far side. With a range marked each
 * flag sits on its edge and can be re-dragged; the toolbar X (or Alt+X) clears
 * the range and docks the flags back on the playhead.
 */
export const PlayheadRangeGrips = memo(function PlayheadRangeGrips({
  maxFrame,
  rulerRef,
}: PlayheadRangeGripsProps) {
  const { t } = useTranslation()
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const { frameToPixels } = useTimelineZoomContext()
  // Range-mode layout uses the committed zoom, matching the ruler's range
  // strip and the tracks highlight so all three always agree on pixels.
  const { frameToPixels: committedFrameToPixels } = useTimelineCommittedZoomContext()
  const [draggingSide, setDraggingSide] = useState<'in' | 'out' | null>(null)

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
    // Track the committed frame only — previewFrame also updates during hover
    // skimming, and the flags must stay glued to the orange playhead line, not
    // chase the mouse.
    return usePlaybackStore.subscribe((state) => {
      updatePosition(state.currentFrame)
    })
  }, [isDocked])

  useLayoutEffect(() => {
    if (!isDocked || !dockedWrapperRef.current) return
    const frame = usePlaybackStore.getState().currentFrame
    dockedWrapperRef.current.style.transform = `translate3d(${Math.round(frameToPixels(frame))}px, 0, 0)`
  }, [frameToPixels, isDocked])

  // Camtasia gesture: double-click anywhere in the timeline OUTSIDE the marked
  // range clears it and docks the flags back on the playhead. Clicks inside
  // the range or on the flags themselves are left alone.
  useEffect(() => {
    const container = rulerRef.current?.closest('.timeline-container')
    if (!container) return

    const handleDoubleClick = (event: Event) => {
      const { clientX, target } = event as MouseEvent
      if (target instanceof Element && target.closest('[data-range-flag]')) return

      const timeline = useTimelineStore.getState()
      if (timeline.inPoint === null && timeline.outPoint === null) return
      const ruler = rulerRef.current
      if (!ruler) return

      const frame = Math.round(pixelsToFrameNow(clientX - ruler.getBoundingClientRect().left))
      const rangeStart = Math.min(
        timeline.inPoint ?? timeline.outPoint ?? 0,
        timeline.outPoint ?? timeline.inPoint ?? 0,
      )
      const rangeEnd = Math.max(
        timeline.inPoint ?? timeline.outPoint ?? 0,
        timeline.outPoint ?? timeline.inPoint ?? 0,
      )
      if (frame < rangeStart || frame > rangeEnd) {
        timeline.clearInOutPoints()
      }
    }

    container.addEventListener('dblclick', handleDoubleClick)
    return () => container.removeEventListener('dblclick', handleDoubleClick)
  }, [rulerRef])

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

      const startClientX = event.clientX
      let moved = false
      let lastFrame = playheadFrame
      const cleanup = beginIoPointerDrag(
        event,
        (clientX) => {
          // A press only becomes a drag once the pointer actually travels;
          // clean taps feed the double-click-to-clear below instead.
          if (!moved && Math.abs(clientX - startClientX) < 3) {
            return
          }
          moved = true

          const rect = ruler.getBoundingClientRect()
          let frame = Math.max(0, Math.round(pixelsToFrameNow(clientX - rect.left)))
          if (maxFrameRef.current !== undefined) {
            frame = Math.min(frame, maxFrameRef.current)
          }
          lastFrame = frame
          // Out first so the in <= out sanitizer never has to intervene.
          if (frame !== anchorFrame) {
            const store = useTimelineStore.getState()
            store.setOutPoint(Math.max(frame, anchorFrame))
            store.setInPoint(Math.min(frame, anchorFrame))
          }
          // Camtasia transport: the real playhead travels with the dragged
          // flag, so the preview shows the frame being extended over and the
          // line parks beside this flag on release.
          usePlaybackStore.getState().setScrubFrame(frame)
          return formatTimecodeCompact(frame, useTimelineStore.getState().fps)
        },
        () => {
          document.body.style.cursor = ''
          if (moved) {
            usePlaybackStore.getState().finishScrub(lastFrame)
          }
          setDraggingSide(null)
          dragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'col-resize'
      setDraggingSide(side)
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

  const inFlag = (
    <RangeFlag
      side="in"
      title={t('timeline.header.setInPointTooltip')}
      active={draggingSide === 'in'}
      onDragStart={handleInDragStart}
    />
  )
  const outFlag = (
    <RangeFlag
      side="out"
      title={t('timeline.header.setOutPointTooltip')}
      active={draggingSide === 'out'}
      onDragStart={handleOutDragStart}
    />
  )

  if (isDocked) {
    return (
      <div
        // Distinct key: the docked wrapper is positioned imperatively via
        // style.transform, and React must never recycle that DOM node into the
        // range-mode wrapper below — the leftover transform would shift every
        // flag by the playhead position.
        key="docked"
        ref={dockedWrapperRef}
        className="absolute top-0 left-0"
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
      key="range"
      className="absolute top-0 left-0"
      style={{ height: IO_LANE_HEIGHT, pointerEvents: 'none', zIndex: 9998, transform: 'none' }}
    >
      <div
        className="absolute top-0"
        style={{ left: Math.round(committedFrameToPixels(inFrame)), height: IO_LANE_HEIGHT }}
      >
        {inFlag}
      </div>
      <div
        className="absolute top-0"
        style={{ left: Math.round(committedFrameToPixels(outFrame)), height: IO_LANE_HEIGHT }}
      >
        {outFlag}
      </div>
    </div>
  )
})
