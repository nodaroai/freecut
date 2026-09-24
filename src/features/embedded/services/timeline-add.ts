import { createLogger } from '@/shared/logging/logger'
import { usePlaybackStore } from '@/shared/state/playback'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { useProjectStore } from '../deps/projects-contract'
import { mediaLibraryService, resolveMediaUrl } from '../deps/media-library-contract'
import {
  addItem,
  buildDroppedMediaTimelineItem,
  findNearestAvailableSpace,
  getDroppedMediaDurationInFrames,
  getTrackKind,
  useItemsStore,
} from '../deps/timeline-contract'

const log = createLogger('embedded-timeline-add')

/** Where a placed take went: the track's own name ("A1") and its start in seconds. */
export interface TimelineAddResult {
  readonly track: string
  readonly at: number
}

/** A chosen spot for a take: the track and the frame it starts on. */
export interface AudioPlacement {
  readonly trackId: string
  readonly trackName: string
  readonly from: number
}

/**
 * Where the parent's "Add to timeline" puts a take (Studio's Soundtrack
 * popover, D36): the first audio track — in the timeline's own order — with
 * room for the whole take at the playhead; when none has, the nearest room on
 * the first audio track. A locked track or a group is never a target. `null`
 * when there is no audio track to place on, or no room anywhere on the first.
 */
export function chooseAudioPlacement(params: {
  readonly tracks: ReadonlyArray<TimelineTrack>
  readonly items: ReadonlyArray<TimelineItem>
  readonly playheadFrame: number
  readonly durationInFrames: number
}): AudioPlacement | null {
  const { tracks, items, playheadFrame, durationInFrames } = params
  const audio = tracks
    .filter((track) => !track.isGroup && !track.locked && getTrackKind(track) === 'audio')
    .slice()
    .sort((a, b) => a.order - b.order)
  const [first] = audio
  if (!first) return null

  const free = audio.find(
    (track) =>
      findNearestAvailableSpace(playheadFrame, durationInFrames, track.id, items) === playheadFrame,
  )
  if (free) return { trackId: free.id, trackName: free.name, from: playheadFrame }

  const from = findNearestAvailableSpace(playheadFrame, durationInFrames, first.id, items)
  return from === null ? null : { trackId: first.id, trackName: first.name, from }
}

/**
 * Put one imported media item on the timeline at the playhead (see
 * {@link chooseAudioPlacement}) — built exactly as a media-bin drop builds it
 * (`buildDroppedMediaTimelineItem`) — and answer where it went. Throws when
 * the media, the project or a place for it is missing; the caller turns that
 * into the refusal the parent reads.
 */
export async function addMediaToTimelineAtPlayhead(mediaId: string): Promise<TimelineAddResult> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('No project is open')

  const metadata = await mediaLibraryService.getMedia(mediaId)
  if (!metadata) throw new Error('That track is not in Media')
  const blobUrl = await resolveMediaUrl(mediaId)
  if (!blobUrl) throw new Error('That track could not be read from Media')

  const fps = project.metadata.fps
  const durationInFrames = getDroppedMediaDurationInFrames(metadata, 'audio', fps)
  const { tracks, items } = useItemsStore.getState()
  const playheadFrame = Math.max(0, Math.round(usePlaybackStore.getState().currentFrame))
  const placement = chooseAudioPlacement({ tracks, items, playheadFrame, durationInFrames })
  if (!placement) throw new Error('There is no audio track with room for it')

  const item = buildDroppedMediaTimelineItem({
    media: metadata,
    mediaId: metadata.id,
    mediaType: 'audio',
    label: metadata.fileName,
    timelineFps: fps,
    blobUrl,
    canvasWidth: project.metadata.width,
    canvasHeight: project.metadata.height,
    placement: { trackId: placement.trackId, from: placement.from, durationInFrames },
  })
  addItem(item)
  log.info('Placed an imported track on the timeline', {
    mediaId,
    track: placement.trackName,
    from: placement.from,
  })
  return { track: placement.trackName, at: placement.from / fps }
}
