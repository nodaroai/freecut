import { memo } from 'react'

import { IO_HANDLE_COLOR } from '@/shared/timeline/io-range'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'

/**
 * Camtasia-style selection tint: a translucent column across the ruler and
 * tracks between the marked in/out points, so the range reads as a selection
 * instead of two lone grips in the ruler lane. Purely visual — pointer events
 * pass through to the clips underneath.
 */
export const TimelineRangeHighlight = memo(function TimelineRangeHighlight() {
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const { frameToPixels } = useTimelineCommittedZoomContext()

  if (inPoint === null || outPoint === null) {
    return null
  }

  const left = frameToPixels(Math.min(inPoint, outPoint))
  const width = Math.max(2, frameToPixels(Math.max(inPoint, outPoint)) - left)

  return (
    <div
      aria-hidden="true"
      className="absolute top-0 bottom-0 pointer-events-none"
      style={{
        left,
        width,
        zIndex: 30,
        background: `color-mix(in oklch, ${IO_HANDLE_COLOR} 11%, transparent)`,
        borderLeft: `1px solid color-mix(in oklch, ${IO_HANDLE_COLOR} 40%, transparent)`,
        borderRight: `1px solid color-mix(in oklch, ${IO_HANDLE_COLOR} 40%, transparent)`,
      }}
    />
  )
})
