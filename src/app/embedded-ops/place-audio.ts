/**
 * `placeAudio { mediaId, from?, durationInFrames?, volumeDb?, fadeOutSeconds?, newTrack? }`:
 * put an audio file on an audio track at a frame (a new track below the
 * others when asked or when none has room), built as a media-bin drop is.
 * A video file is refused: `placeMedia` places those.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { getMediaType } from '@/features/media-library/utils/validation'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addItem, setTracks } from '@/features/timeline/stores/timeline-actions'
import { createClassicTrack, getTrackKind } from '@/features/timeline/utils/classic-tracks'
import { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils'
import {
  buildDroppedMediaTimelineItem,
  getDroppedMediaDurationInFrames,
} from '@/features/timeline/utils/dropped-media'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import { preparedData } from './media-prep'
import { optionalNumber, requireString } from './op-fields'
import { projectCanvas, timelineFps } from './timeline-context'

const prepared = preparedData<{ media: MediaMetadata; blobUrl: string }>('placeAudio')

export async function preparePlaceAudio(op: EditOp): Promise<EditOp> {
  const mediaId = requireString(op, 'mediaId')
  const media = await mediaLibraryService.getMedia(mediaId)
  if (!media) throw new Error(`Media ${mediaId} is not in Media`)
  if (getMediaType(media.mimeType) !== 'audio') {
    throw new Error(`placeAudio places an audio file; ${media.fileName} is not one`)
  }
  const blobUrl = await resolveMediaUrl(mediaId)
  if (!blobUrl) throw new Error(`Media ${mediaId} could not be read`)
  return prepared.attach(op, { media, blobUrl })
}

/** An audio track with room for the whole span at `from`, or a new one below the others. */
function audioTrackFor(from: number, durationInFrames: number, forceNew: boolean) {
  const { tracks, items } = useItemsStore.getState()
  if (!forceNew) {
    const free = tracks
      .filter((track) => !track.isGroup && !track.locked && getTrackKind(track) === 'audio')
      .toSorted((a, b) => a.order - b.order)
      .find((track) => findNearestAvailableSpace(from, durationInFrames, track.id, items) === from)
    if (free) return free.id
  }
  const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
  const track = createClassicTrack({ tracks, kind: 'audio', order })
  setTracks([...tracks, track])
  return track.id
}

export function applyPlaceAudio(op: EditOp): unknown {
  const { media, blobUrl } = prepared.read(op)
  const metadata = projectCanvas()
  const fps = timelineFps()
  const from = Math.max(0, Math.round(optionalNumber(op, 'from') ?? 0))
  const fullLength = getDroppedMediaDurationInFrames(media, 'audio', fps)
  const asked = optionalNumber(op, 'durationInFrames')
  const durationInFrames = Math.max(1, Math.min(fullLength, Math.round(asked ?? fullLength)))
  const trackId = audioTrackFor(from, durationInFrames, op.newTrack === true)

  const item = buildDroppedMediaTimelineItem({
    media,
    mediaId: media.id,
    mediaType: 'audio',
    label: typeof op.label === 'string' && op.label ? op.label : media.fileName,
    timelineFps: fps,
    blobUrl,
    canvasWidth: metadata.width,
    canvasHeight: metadata.height,
    placement: { trackId, from, durationInFrames },
  })
  const volumeDb = optionalNumber(op, 'volumeDb')
  const fadeOut = optionalNumber(op, 'fadeOutSeconds')
  addItem({
    ...item,
    ...(volumeDb === undefined ? {} : { volume: volumeDb }),
    ...(fadeOut === undefined ? {} : { audioFadeOut: Math.max(0, fadeOut) }),
  } as TimelineItem)
  // Placement may move an item off an overlap: answer where it actually went.
  const placed = useItemsStore.getState().itemById[item.id]
  return {
    id: item.id,
    trackId: placed?.trackId ?? trackId,
    from: placed?.from ?? from,
    durationInFrames: placed?.durationInFrames ?? durationInFrames,
  }
}
