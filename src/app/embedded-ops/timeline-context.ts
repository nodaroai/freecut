/**
 * What the operations read from the open project and its live timeline.
 */
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { AudioItem, TimelineItem, VideoItem } from '@/types/timeline'

export type MediaClip = AudioItem | VideoItem

const isMediaClip = (item: TimelineItem, mediaId: string): item is MediaClip =>
  (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId

/** The video and audio clips of one media file, possibly none. */
export function mediaClipsOf(mediaId: string): MediaClip[] {
  return useItemsStore.getState().items.filter((item) => isMediaClip(item, mediaId))
}

/** The video and audio clips of one media file; refuses a file with none on the timeline. */
export function clipsOf(mediaId: string): MediaClip[] {
  const clips = mediaClipsOf(mediaId)
  if (clips.length === 0) throw new Error(`No clip of media ${mediaId} is on the timeline`)
  return clips
}

export function projectCanvas() {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('No project is open')
  return project.metadata
}

/** The live timeline's frame rate. */
export function timelineFps(): number {
  return useTimelineSettingsStore.getState().fps || projectCanvas().fps
}

/** An item of the live timeline, or a clear refusal. */
export function requireTimelineItem(opName: string, id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`${opName}: item "${id}" is not on the timeline`)
  return item
}
