/**
 * `splitItems { ids, frames }`: split the named clips at each of the timeline
 * frames that falls inside one of them, and answer `{ splits }` (how many were
 * made). A frame at a clip's edge, or inside no named clip, is skipped.
 *
 * A clip's linked sound is split with it, as when a person splits a clip, so
 * each piece keeps its own sound. A parent that frames each shot of a
 * recording on its own splits the recording at its shot changes first.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { splitItem } from '@/features/timeline/stores/timeline-actions'
import { fail } from './op-fields'

export function applySplitItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  const frames = Array.isArray(op.frames)
    ? op.frames.filter((f): f is number => typeof f === 'number' && Number.isFinite(f))
    : []
  if (ids.length === 0) fail(op, 'needs a non-empty `ids` list')
  if (frames.length === 0) fail(op, 'needs a non-empty `frames` list')
  const known = useItemsStore.getState().itemById
  const missing = ids.find((id) => !known[id])
  if (missing) fail(op, `no item ${missing} is on the timeline`)

  // The pieces of the named clips, as they are split further.
  const pieces = new Set(ids)
  let splits = 0
  for (const frame of [...new Set(frames.map(Math.round))].sort((a, b) => a - b)) {
    const byId = useItemsStore.getState().itemById
    const target = [...pieces].find((id) => {
      const item = byId[id]
      return item && frame > item.from && frame < item.from + item.durationInFrames
    })
    if (!target) continue
    const result = splitItem(target, frame)
    if (!result) continue
    pieces.add(result.leftItem.id)
    pieces.add(result.rightItem.id)
    splits += 1
  }
  return { splits }
}
