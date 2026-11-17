/**
 * `duplicateItems { ids }`: a silent copy of each named picture clip, all on
 * one track directly above the footage (under text and captions), at the same
 * place and with the same source range. Answers `{ trackId, copies: [{ of, id }] }`.
 *
 * A parent that shows one recording several times in the frame (each speaker
 * in a part of their own) copies its clips, then crops and places each copy.
 * The copies ripple with later cuts like any clip.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addItems } from '@/features/timeline/stores/timeline-actions'
import type { TimelineItem } from '@/types/timeline'
import { fail } from './op-fields'
import { trackFor } from './track-placement'

const PICTURE_TYPES = new Set<TimelineItem['type']>(['video', 'image'])

export function applyDuplicateItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) fail(op, 'needs a non-empty `ids` list')
  const byId = useItemsStore.getState().itemById
  const sources = ids.map((id) => {
    const item = byId[id]
    if (!item) fail(op, `no item ${id} is on the timeline`)
    if (!PICTURE_TYPES.has(item.type)) fail(op, `item ${id} is not a picture clip`)
    return item
  })
  const from = Math.min(...sources.map((item) => item.from))
  const to = Math.max(...sources.map((item) => item.from + item.durationInFrames))
  const trackId = trackFor({ opName: op.op, kind: 'video', from, durationInFrames: to - from })
  const copies = sources.map((item) => ({
    of: item.id,
    item: {
      ...item,
      id: crypto.randomUUID(),
      originId: crypto.randomUUID(),
      trackId,
      linkedGroupId: undefined,
      ...(item.type === 'video' ? { embeddedAudioMuted: true } : {}),
    } as TimelineItem,
  }))
  addItems(copies.map((copy) => copy.item))
  return { trackId, copies: copies.map((copy) => ({ of: copy.of, id: copy.item.id })) }
}
