/**
 * `removeSourceRanges { mediaId, ranges: [{ start, end }] }`: cut those seconds
 * of the media out of every clip of it, and close the gaps (the same
 * split-then-ripple removal as Remove silence).
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { removeTranscriptRangesFromItems } from '@/features/timeline/stores/actions/edit/range-removal-actions'
import { requireRanges, requireString } from './op-fields'
import { clipsOf } from './timeline-context'

export function applyRemoveSourceRanges(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const ranges = requireRanges(op, 'ranges')
  const result = removeTranscriptRangesFromItems(
    clipsOf(mediaId).map((clip) => clip.id),
    { [mediaId]: ranges },
  )
  if (result.removedRangeCount === 0) {
    throw new Error('None of the ranges could be cut from the clips on the timeline')
  }
  return { removedRangeCount: result.removedRangeCount, removedItemCount: result.removedItemCount }
}
