import type { TimelineItem, VideoItem } from '@/types/timeline'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { emitUiSound } from '@/shared/ui/ui-sound'
import { useItemsStore } from '../items-store'
import { useKeyframesStore, type KeyframeAddPayload } from '../keyframes-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { buildLinkedAudioForVideo } from '../../utils/embedded-audio-split'
import { execute } from './shared'

/**
 * A video clip qualifies for audio separation when its source media actually
 * has an audio stream and no linked audio companion exists yet on the
 * timeline. Clips placed through the regular drop flow arrive already split,
 * so this mostly serves canvas drops, unlinked clips, and imported projects.
 */
export function canSeparateVideoAudio(item: TimelineItem): boolean {
  if (item.type !== 'video' || !item.mediaId) {
    return false
  }

  const media = useMediaLibraryStore.getState().mediaById[item.mediaId]
  if (!media?.audioCodec) {
    return false
  }

  return getLinkedAudioCompanion(useItemsStore.getState().items, item) === null
}

function buildVolumeKeyframePayloads(video: VideoItem, audioItemId: string): KeyframeAddPayload[] {
  const volumeProperty = useKeyframesStore
    .getState()
    .keyframesByItemId[video.id]?.properties.find((property) => property.property === 'volume')

  return (volumeProperty?.keyframes ?? []).map((keyframe) => ({
    itemId: audioItemId,
    property: 'volume',
    frame: keyframe.frame,
    value: keyframe.value,
    easing: keyframe.easing,
    easingConfig: keyframe.easingConfig,
  }))
}

/**
 * Split a video clip's embedded audio onto its own linked audio item —
 * the context-menu counterpart of the automatic split that happens on a
 * timeline drop. One undoable step: assigns a linked group, places the
 * companion on an audio track (creating one only when none has room), and
 * carries volume automation over to the item that now makes the sound.
 */
export function separateVideoAudio(itemId: string): boolean {
  const item = useItemsStore.getState().itemById[itemId]
  if (!item || item.type !== 'video' || !canSeparateVideoAudio(item)) {
    return false
  }

  const itemsState = useItemsStore.getState()
  const itemsByTrackId = new Map<string, TimelineItem[]>()
  for (const existing of itemsState.items) {
    const bucket = itemsByTrackId.get(existing.trackId)
    if (bucket) {
      bucket.push(existing)
    } else {
      itemsByTrackId.set(existing.trackId, [existing])
    }
  }

  const { updatedVideo, audioItem, newTrack } = buildLinkedAudioForVideo({
    video: item,
    tracks: itemsState.tracks,
    itemsByTrackId,
  })
  const keyframePayloads = buildVolumeKeyframePayloads(item, audioItem.id)

  execute(
    'SEPARATE_VIDEO_AUDIO',
    () => {
      const store = useItemsStore.getState()
      if (newTrack) {
        store.setTracks([...store.tracks, newTrack])
      }
      // The companion is audible from now on; clearing the embedded mute keeps
      // the pair consistent with the LINK_ITEMS convention.
      store._updateItem(item.id, {
        linkedGroupId: updatedVideo.linkedGroupId,
        embeddedAudioMuted: undefined,
      })
      store._addItem(audioItem)
      if (keyframePayloads.length > 0) {
        useKeyframesStore.getState()._addKeyframes(keyframePayloads)
      }
      useTimelineSettingsStore.getState().markDirty()
    },
    { itemId: item.id, audioId: audioItem.id, trackCreated: !!newTrack },
  )

  emitUiSound('confirm')
  return true
}
