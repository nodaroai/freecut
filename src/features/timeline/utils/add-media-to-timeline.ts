import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { createLogger } from '@/shared/logging/logger'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { mapWithConcurrency } from '@/shared/utils/async-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useTimelineStore } from '../stores/timeline-store'
import { useProjectStore } from '../deps/projects'
import { getMediaType, resolveMediaUrl } from '../deps/media-library-resolver'
import type { CollisionRect } from './collision-utils'
import { isDroppableMediaType } from './drag-drop-preview'
import { applyResolvedTimelineDrop, type DroppedMediaEntry } from './drop-execution'
import { prewarmDroppedTimelineAudio } from './drop-audio-prewarm'
import { buildDroppedMediaTimelineItems, getDroppedMediaDurationInFrames } from './dropped-media'
import { findCompatibleTrackForItemType } from './track-item-compatibility'
import { planTrackMediaDropPlacements, type TrackMediaDropPlannedItem } from './track-media-drop'
import { planNewTrackZonePlacements, type NewTrackZonePlannedItem } from './new-track-zone-media'

const logger = createLogger('AddMediaToTimeline')

const METADATA_CONCURRENCY = 3

export type AddMediaToTimelinePosition = 'playhead' | 'end'

type PlannedMediaItem =
  | TrackMediaDropPlannedItem<DroppedMediaEntry>
  | NewTrackZonePlannedItem<DroppedMediaEntry>

function buildAddableEntries(mediaItems: MediaMetadata[]): DroppedMediaEntry[] {
  return mediaItems.flatMap((media) => {
    const mediaType = getMediaType(media.mimeType)
    if (!isDroppableMediaType(mediaType)) {
      return []
    }

    return [{ media, mediaId: media.id, mediaType, label: media.fileName }]
  })
}

function getTimelineEndFrame(items: TimelineItem[]): number {
  let endFrame = 0
  for (const item of items) {
    endFrame = Math.max(endFrame, item.from + item.durationInFrames)
  }
  return endFrame
}

function toPlanEntry(entry: DroppedMediaEntry, fps: number) {
  return {
    payload: entry,
    label: entry.label,
    mediaType: entry.mediaType,
    durationInFrames: getDroppedMediaDurationInFrames(entry.media, entry.mediaType, fps),
    hasLinkedAudio: entry.mediaType === 'video' && !!entry.media.audioCodec,
  }
}

function resolveNewTrackAnchor(
  tracks: TimelineTrack[],
  activeTrackId: string | null,
): { anchorTrackId: string; preferredTrackHeight: number } {
  const activeTrack = tracks.find((track) => track.id === activeTrackId && !track.isGroup)
  const anchorTrack = activeTrack ?? tracks.find((track) => !track.isGroup)
  return {
    anchorTrackId: anchorTrack?.id ?? '',
    preferredTrackHeight: anchorTrack?.height ?? 64,
  }
}

function planEntriesOntoTracks(params: {
  entries: DroppedMediaEntry[]
  startFrame: number
  tracks: TimelineTrack[]
  items: TimelineItem[]
  activeTrackId: string | null
  fps: number
}): { plannedItems: PlannedMediaItem[]; tracks: TimelineTrack[] } {
  const plannedItems: PlannedMediaItem[] = []
  const reservedRects: CollisionRect[] = []
  let workingTracks = params.tracks

  // Visual entries are planned first so that standalone audio, planned second
  // against the accumulated reservations, never overlaps the linked-audio
  // placements that videos with sound reserve on the audio track.
  const groups = [
    { zone: 'video' as const, entries: params.entries.filter((e) => e.mediaType !== 'audio') },
    { zone: 'audio' as const, entries: params.entries.filter((e) => e.mediaType === 'audio') },
  ]

  for (const group of groups) {
    if (group.entries.length === 0) {
      continue
    }

    const planEntries = group.entries.map((entry) => toPlanEntry(entry, params.fps))
    const existingItems: CollisionRect[] = [...params.items, ...reservedRects]
    const targetTrack = findCompatibleTrackForItemType({
      tracks: workingTracks,
      items: params.items,
      itemType: group.zone,
      preferredTrackId: params.activeTrackId,
    })

    // Sequence onto an existing compatible track when one is available; fall
    // back to the new-track-zone planner (which creates the track) otherwise —
    // e.g. audio files on a timeline that has no audio track yet.
    const result = targetTrack
      ? planTrackMediaDropPlacements({
          entries: planEntries,
          dropFrame: params.startFrame,
          tracks: workingTracks,
          existingItems,
          dropTargetTrackId: targetTrack.id,
        })
      : planNewTrackZonePlacements({
          entries: planEntries,
          dropFrame: params.startFrame,
          tracks: workingTracks,
          existingItems,
          zone: group.zone,
          ...resolveNewTrackAnchor(workingTracks, params.activeTrackId),
        })

    if (result.plannedItems.length === 0) {
      continue
    }

    workingTracks = result.tracks
    plannedItems.push(...result.plannedItems)
    for (const planned of result.plannedItems) {
      for (const placement of planned.placements) {
        reservedRects.push({
          from: placement.from,
          durationInFrames: placement.durationInFrames,
          trackId: placement.trackId,
        })
      }
    }
  }

  return { plannedItems, tracks: workingTracks }
}

async function resolvePlannedTimelineItems(
  plannedItems: PlannedMediaItem[],
  fps: number,
): Promise<TimelineItem[]> {
  const currentProject = useProjectStore.getState().currentProject
  const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT

  const resolved = await mapWithConcurrency(
    plannedItems,
    METADATA_CONCURRENCY,
    async (planned): Promise<TimelineItem[] | null> => {
      const entry = planned.entry.payload
      const blobUrl = await resolveMediaUrl(entry.mediaId)

      if (!blobUrl) {
        logger.error('Failed to get media blob URL for', planned.entry.label)
        return null
      }

      const primaryPlacement =
        planned.placements.find((placement) => placement.mediaType !== 'audio') ??
        planned.placements[0]!
      const linkedAudioPlacement = planned.placements.find(
        (placement) => placement.mediaType === 'audio',
      )

      return buildDroppedMediaTimelineItems({
        media: entry.media,
        mediaId: entry.mediaId,
        mediaType: planned.entry.mediaType,
        label: planned.entry.label,
        timelineFps: fps,
        blobUrl,
        thumbnailUrl: null,
        canvasWidth,
        canvasHeight,
        placement: {
          primary: {
            trackId: primaryPlacement.trackId,
            from: primaryPlacement.from,
            durationInFrames: primaryPlacement.durationInFrames,
          },
          linkedAudio: linkedAudioPlacement
            ? {
                trackId: linkedAudioPlacement.trackId,
                from: linkedAudioPlacement.from,
                durationInFrames: linkedAudioPlacement.durationInFrames,
              }
            : undefined,
        },
        linkVideoAudio: planned.linkVideoAudio,
      })
    },
  )

  return resolved.flatMap((items) => items ?? [])
}

/**
 * Adds media-library items onto the timeline without a drag gesture — the
 * context-menu counterpart of dropping them onto a track. `playhead` sequences
 * the items starting at the current playback frame; `end` appends them after
 * the last clip on any track. Placement reuses the drop planners, so linked
 * audio splitting, collision avoidance, and track creation behave exactly like
 * a drop.
 */
export async function addMediaItemsToTimeline(
  mediaItems: MediaMetadata[],
  position: AddMediaToTimelinePosition,
): Promise<void> {
  const entries = buildAddableEntries(mediaItems)
  if (entries.length === 0) {
    toast.error(i18n.t('timeline.track.noSupportedMediaInDrop'))
    return
  }

  const timelineState = useTimelineStore.getState()
  const startFrame =
    position === 'end'
      ? getTimelineEndFrame(timelineState.items)
      : Math.max(0, usePlaybackStore.getState().currentFrame)

  const plan = planEntriesOntoTracks({
    entries,
    startFrame,
    tracks: timelineState.tracks,
    items: timelineState.items,
    activeTrackId: useSelectionStore.getState().activeTrackId,
    fps: timelineState.fps,
  })

  const items = await resolvePlannedTimelineItems(plan.plannedItems, timelineState.fps)
  const dropResult = { items, tracks: plan.tracks }
  prewarmDroppedTimelineAudio(entries, dropResult.items)

  const store = useTimelineStore.getState()
  applyResolvedTimelineDrop({
    addItem: store.addItem,
    addItems: store.addItems,
    currentTracks: store.tracks,
    dropResult,
    emptyMessage: i18n.t('timeline.track.unableToAddDroppedMediaItems'),
    notify: toast,
    partialFailureLabel: i18n.t('timeline.track.droppedMediaItems'),
    requestedCount: entries.length,
    setTracks: store.setTracks,
  })
}
