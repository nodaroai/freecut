/**
 * Choosing the track a placed file goes on. Lower `order` is higher on screen.
 *
 * - A picture (an image, or a video placed without its sound) goes directly
 *   above the clips' picture, under any text and caption tracks: on a free
 *   track there when one has room, else on a new one. `newTrack: 'above'`
 *   makes a new track on top of everything; `'below'`, one under the picture.
 * - Sound goes on the first audio track with room, else on a new audio track
 *   under the others. `newTrack: 'below'` always makes one there; `'above'`
 *   makes one over the other audio tracks.
 * - `syncLock: false` keeps the file on a track that ripple edits (such as
 *   range removal) leave alone; such tracks are kept for files that ask for it.
 */
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { setTracks } from '@/features/timeline/stores/timeline-actions'
import { createClassicTrack, getTrackKind } from '@/features/timeline/utils/classic-tracks'
import { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

export interface TrackRequest {
  readonly opName: string
  readonly kind: 'video' | 'audio'
  readonly from: number
  readonly durationInFrames: number
  readonly trackId?: string
  readonly newTrack?: 'above' | 'below'
  readonly syncLock?: boolean
}

const PICTURE_TYPES = new Set<TimelineItem['type']>(['video', 'image', 'lottie', 'composition'])
const OVERLAY_TYPES = new Set<TimelineItem['type']>(['text', 'subtitle', 'shape'])

const usable = (track: TimelineTrack) => !track.isGroup && !track.locked
const byOrder = (a: TimelineTrack, b: TimelineTrack) => a.order - b.order

function hasRoom(track: TimelineTrack, request: TrackRequest, items: TimelineItem[]): boolean {
  return (
    findNearestAvailableSpace(request.from, request.durationInFrames, track.id, items) ===
    request.from
  )
}

const syncLockFits = (track: TimelineTrack, request: TrackRequest) =>
  request.syncLock === false ? track.syncLock === false : track.syncLock !== false

/** An order directly above `reference` (between it and the track over it). */
function orderAbove(tracks: TimelineTrack[], reference: number): number {
  const over = tracks.map((track) => track.order).filter((order) => order < reference)
  return over.length > 0 ? (Math.max(...over) + reference) / 2 : reference - 1
}

/** An order directly below `reference` (between it and the track under it). */
function orderBelow(tracks: TimelineTrack[], reference: number): number {
  const under = tracks.map((track) => track.order).filter((order) => order > reference)
  return under.length > 0 ? (Math.min(...under) + reference) / 2 : reference + 1
}

function pictureTrackOrders(tracks: TimelineTrack[], items: TimelineItem[]): number[] {
  const ids = new Set(items.filter((item) => PICTURE_TYPES.has(item.type)).map((i) => i.trackId))
  return tracks.filter((track) => ids.has(track.id)).map((track) => track.order)
}

function newTrackOrder(request: TrackRequest, tracks: TimelineTrack[], items: TimelineItem[]) {
  const orders = tracks.map((track) => track.order)
  if (request.kind === 'audio') {
    const audio = tracks.filter((track) => getTrackKind(track) === 'audio').map((t) => t.order)
    if (request.newTrack === 'above' && audio.length > 0)
      return orderAbove(tracks, Math.min(...audio))
    return Math.max(-1, ...orders) + 1
  }
  if (request.newTrack === 'above') return Math.min(1, ...orders) - 1
  const picture = pictureTrackOrders(tracks, items)
  if (picture.length === 0) return Math.min(1, ...orders) - 1
  return request.newTrack === 'below'
    ? orderBelow(tracks, Math.max(...picture))
    : orderAbove(tracks, Math.min(...picture))
}

/** A free track for the request: the first audio track, or the picture track nearest above the footage. */
function findFreeTrack(request: TrackRequest, tracks: TimelineTrack[], items: TimelineItem[]) {
  const fitting = tracks
    .filter((track) => usable(track) && getTrackKind(track) === request.kind)
    .filter((track) => syncLockFits(track, request) && hasRoom(track, request, items))
    .toSorted(byOrder)
  if (request.kind === 'audio') return fitting[0]
  const picture = pictureTrackOrders(tracks, items)
  if (picture.length === 0) return undefined
  const footage = Math.max(...picture)
  const overlayTrackIds = new Set(
    items.filter((item) => OVERLAY_TYPES.has(item.type)).map((item) => item.trackId),
  )
  return fitting.filter((track) => track.order < footage && !overlayTrackIds.has(track.id)).at(-1)
}

function createTrack(request: TrackRequest, tracks: TimelineTrack[], items: TimelineItem[]) {
  const created = createClassicTrack({
    tracks,
    kind: request.kind,
    order: newTrackOrder(request, tracks, items),
  })
  const track = request.syncLock === false ? { ...created, syncLock: false } : created
  setTracks([...tracks, track])
  return track.id
}

function namedTrack(request: TrackRequest & { trackId: string }): string {
  const { tracks, items } = useItemsStore.getState()
  const track = tracks.find((candidate) => candidate.id === request.trackId)
  const name = `${request.opName}: track "${request.trackId}"`
  if (!track) throw new Error(`${name} does not exist`)
  if (!usable(track)) throw new Error(`${name} is locked or a group`)
  if (getTrackKind(track) !== request.kind)
    throw new Error(`${name} is not a ${request.kind} track`)
  if (!hasRoom(track, request, items)) {
    throw new Error(
      `${name} has no room for ${request.durationInFrames} frames at frame ${request.from}`,
    )
  }
  if (request.syncLock !== undefined && (track.syncLock !== false) !== request.syncLock) {
    setTracks(tracks.map((t) => (t.id === track.id ? { ...t, syncLock: request.syncLock } : t)))
  }
  return track.id
}

/** The id of the track the request lands on, creating it when needed. */
export function trackFor(request: TrackRequest): string {
  if (request.trackId) return namedTrack({ ...request, trackId: request.trackId })
  const { tracks, items } = useItemsStore.getState()
  if (!request.newTrack) {
    const free = findFreeTrack(request, tracks, items)
    if (free) return free.id
  }
  return createTrack(request, tracks, items)
}
