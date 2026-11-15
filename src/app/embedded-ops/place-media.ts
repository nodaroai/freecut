/**
 * Putting media files on the timeline at a frame.
 * - `placeMedia { mediaId | ref, from, durationInFrames?, sourceStartSeconds?,
 *   trackId? | newTrack?: 'above' | 'below', syncLock?, volumeDb?,
 *   fadeInSeconds?, fadeOutSeconds?, fit?: 'cover' | 'contain', label? }`:
 *   an image or a video (placed without its sound) goes on a video track
 *   above the footage; an audio file goes on an audio track (see
 *   `track-placement.ts`). A ref that is still being imported is waited for.
 *   Answers `{ id, trackId, from, durationInFrames }`.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addItem } from '@/features/timeline/stores/timeline-actions'
import { buildMediaTimelineItem } from '@/features/timeline/utils/media-timeline-item-builder'
import type { TimelineItem } from '@/types/timeline'
import { prepareMedia, preparedData, type PreparedMedia } from './media-prep'
import {
  fail,
  optionalBoolean,
  optionalChoice,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from './op-fields'
import { projectCanvas, timelineFps } from './timeline-context'
import { trackFor } from './track-placement'

const IMAGE_SECONDS = 3

const prepared = preparedData<PreparedMedia>('placeMedia')

export async function preparePlaceMedia(op: EditOp): Promise<EditOp> {
  const mediaId = requireString(op, 'mediaId')
  return prepared.attach(op, await prepareMedia(op, mediaId))
}

function readNonNegative(op: EditOp, field: string): number | undefined {
  const value = optionalNumber(op, field)
  if (value !== undefined && value < 0) fail(op, `\`${field}\` must be 0 or more`)
  return value
}

interface PlacementTiming {
  from: number
  durationInFrames: number
  sourceStart?: number
}

/** Where the item starts, how long it lasts and where in the file it begins. */
function readTiming(op: EditOp, prep: PreparedMedia, fps: number): PlacementTiming {
  const from = Math.round(requireNumber(op, 'from'))
  if (from < 0) fail(op, '`from` must be a frame, 0 or more')
  const asked = optionalNumber(op, 'durationInFrames')
  if (asked !== undefined && asked < 1) fail(op, '`durationInFrames` must be 1 or more')
  if (prep.kind === 'image') {
    return { from, durationInFrames: Math.round(asked ?? fps * IMAGE_SECONDS) }
  }
  const startSeconds = readNonNegative(op, 'sourceStartSeconds') ?? 0
  const available = Math.floor((prep.media.duration - startSeconds) * fps)
  if (available < 1) {
    fail(op, `\`sourceStartSeconds\` is past the end of ${prep.media.fileName}`)
  }
  const sourceFps = prep.media.fps || fps
  return {
    from,
    durationInFrames: Math.min(available, Math.round(asked ?? available)),
    sourceStart: Math.round(startSeconds * sourceFps),
  }
}

/** The transform that fills (`cover`) the canvas; `contain` is the builder's default fit. */
function coverTransform(item: TimelineItem, prep: PreparedMedia) {
  const canvas = projectCanvas()
  const width = prep.media.width || canvas.width
  const height = prep.media.height || canvas.height
  const scale = Math.max(canvas.width / width, canvas.height / height)
  return {
    transform: {
      ...item.transform,
      x: 0,
      y: 0,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
  }
}

/** Gain, fades, fit and silence for the built item, as the operation asks. */
function itemDetails(op: EditOp, item: TimelineItem, prep: PreparedMedia): Partial<TimelineItem> {
  const volumeDb = optionalNumber(op, 'volumeDb')
  const fadeIn = readNonNegative(op, 'fadeInSeconds')
  const fadeOut = readNonNegative(op, 'fadeOutSeconds')
  const fit = optionalChoice(op, 'fit', ['cover', 'contain'] as const)
  if (prep.kind === 'audio') {
    if (fit) fail(op, '`fit` applies to an image or a video')
    return {
      ...(volumeDb === undefined ? {} : { volume: volumeDb }),
      ...(fadeIn === undefined ? {} : { audioFadeIn: fadeIn }),
      ...(fadeOut === undefined ? {} : { audioFadeOut: fadeOut }),
    }
  }
  if (volumeDb !== undefined) {
    fail(op, `\`volumeDb\` applies to sound; ${prep.media.fileName} is placed without it`)
  }
  return {
    ...(prep.kind === 'video' ? { embeddedAudioMuted: true } : {}),
    ...(fadeIn === undefined ? {} : { fadeIn }),
    ...(fadeOut === undefined ? {} : { fadeOut }),
    ...(fit === 'cover' ? coverTransform(item, prep) : {}),
  } as Partial<TimelineItem>
}

export function applyPlaceMedia(op: EditOp): unknown {
  const prep = prepared.read(op)
  const fps = timelineFps()
  const canvas = projectCanvas()
  const timing = readTiming(op, prep, fps)
  const trackId = trackFor({
    opName: op.op,
    kind: prep.kind === 'audio' ? 'audio' : 'video',
    from: timing.from,
    durationInFrames: timing.durationInFrames,
    trackId: optionalString(op, 'trackId'),
    newTrack: optionalChoice(op, 'newTrack', ['above', 'below'] as const),
    syncLock: optionalBoolean(op, 'syncLock'),
  })
  const built = buildMediaTimelineItem({
    media: prep.media,
    mediaId: prep.media.id,
    mediaType: prep.kind,
    label: optionalString(op, 'label') ?? prep.media.fileName,
    projectFps: fps,
    blobUrl: prep.blobUrl,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    placement: { trackId, from: timing.from, durationInFrames: timing.durationInFrames },
    originId: crypto.randomUUID(),
    ...(timing.sourceStart === undefined ? {} : { sourceStart: timing.sourceStart }),
  })
  addItem({ ...built, ...itemDetails(op, built, prep) } as TimelineItem)
  const placed = useItemsStore.getState().itemById[built.id]
  return {
    id: built.id,
    trackId: placed?.trackId ?? trackId,
    from: placed?.from ?? timing.from,
    durationInFrames: placed?.durationInFrames ?? timing.durationInFrames,
  }
}
