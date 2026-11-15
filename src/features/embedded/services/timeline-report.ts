import { usePlaybackStore } from '@/shared/state/playback'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  getActiveTabId,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useMarkersStore,
  useSequencesStore,
  useTimelineSettingsStore,
} from '../deps/timeline-contract'
import { useProjectStore } from '../deps/projects-contract'
import { useMediaLibraryStore } from '../deps/media-library-contract'

type MediaById = ReturnType<typeof useMediaLibraryStore.getState>['mediaById']

interface Size {
  width: number
  height: number
}

const round = (value: number) => Math.round(value * 100) / 100

/** Where a video or audio item's footage starts and ends, so a parent can map media time to the timeline. */
function sourceFields(item: TimelineItem) {
  if (item.type !== 'video' && item.type !== 'audio') return {}
  return {
    ...(item.sourceStart === undefined ? {} : { sourceStart: item.sourceStart }),
    ...(item.sourceEnd === undefined ? {} : { sourceEnd: item.sourceEnd }),
    ...(item.sourceFps === undefined ? {} : { sourceFps: item.sourceFps }),
    ...(item.speed === undefined ? {} : { speed: item.speed }),
  }
}

/** The picture's own size, when the item has one. */
function sourceSize(item: TimelineItem, mediaById: MediaById): Size | null {
  if (item.type === 'video' || item.type === 'image' || item.type === 'lottie') {
    if (item.sourceWidth && item.sourceHeight) {
      return { width: item.sourceWidth, height: item.sourceHeight }
    }
    const media = item.mediaId ? mediaById[item.mediaId] : undefined
    return media?.width && media.height ? { width: media.width, height: media.height } : null
  }
  if (item.type === 'composition') {
    return { width: item.compositionWidth, height: item.compositionHeight }
  }
  return null
}

/**
 * A visual item's place on the canvas, in pixels with x and y from the canvas
 * center, as setTransform takes it. An item with no transform of its own is
 * fitted to the canvas, as the renderer fits it.
 */
function visualTransform(item: TimelineItem, canvas: Size, mediaById: MediaById) {
  if (item.type === 'audio') return {}
  const source = sourceSize(item, mediaById) ?? canvas
  const fit = Math.min(canvas.width / source.width, canvas.height / source.height)
  const transform = item.transform
  return {
    transform: {
      x: round(transform?.x ?? 0),
      y: round(transform?.y ?? 0),
      width: round(transform?.width ?? source.width * fit),
      height: round(transform?.height ?? source.height * fit),
    },
  }
}

function itemDetails(item: TimelineItem, canvas: Size, mediaById: MediaById) {
  return {
    ...(item.linkedGroupId ? { linkedGroupId: item.linkedGroupId } : {}),
    ...(item.type === 'video' || item.type === 'audio' ? { volumeDb: item.volume ?? 0 } : {}),
    ...visualTransform(item, canvas, mediaById),
    ...(item.type === 'subtitle'
      ? {
          cues: item.cues.map((cue) => ({
            startSeconds: cue.startSeconds,
            endSeconds: cue.endSeconds,
            text: cue.text,
          })),
        }
      : {}),
    ...(item.effects?.length
      ? {
          effects: item.effects.map((entry) => ({
            id: entry.id,
            type: entry.effect.gpuEffectType,
            enabled: entry.enabled,
          })),
        }
      : {}),
  }
}

function reportItem(item: TimelineItem, canvas: Size, mediaById: MediaById) {
  return {
    id: item.id,
    type: item.type,
    trackId: item.trackId,
    from: item.from,
    durationInFrames: item.durationInFrames,
    ...(item.label ? { label: item.label } : {}),
    ...('mediaId' in item && item.mediaId ? { mediaId: item.mediaId } : {}),
    ...('text' in item && typeof item.text === 'string' ? { text: item.text } : {}),
    ...sourceFields(item),
    ...itemDetails(item, canvas, mediaById),
  }
}

const reportTrack = (track: TimelineTrack) => ({
  id: track.id,
  name: track.name,
  kind: track.kind ?? null,
  order: track.order,
  syncLock: track.syncLock !== false,
})

/** The timeline tabs after Main, each with its canvas and length; `active` marks the open one. */
function readSequences(liveDuration: number) {
  const { breadcrumbs, activeCompositionId } = useCompositionNavigationStore.getState()
  const activeTab = getActiveTabId(breadcrumbs)
  const { compositionById } = useCompositionsStore.getState()
  return useSequencesStore.getState().topLevelSequenceIds.flatMap((id) => {
    const sequence = compositionById[id]
    if (!sequence) return []
    // The open sequence lives in the timeline's stores; its stored copy lags behind.
    const live = activeCompositionId === id
    return [
      {
        id,
        name: sequence.name,
        width: sequence.width,
        height: sequence.height,
        durationInFrames: live ? liveDuration : sequence.durationInFrames,
        active: activeTab === id,
      },
    ]
  })
}

/** The canvas the open timeline is drawn on: its sequence's or composition's, else the project's. */
function liveCanvas(project: Size | null): Size {
  const { activeCompositionId } = useCompositionNavigationStore.getState()
  const composition = activeCompositionId
    ? useCompositionsStore.getState().compositionById[activeCompositionId]
    : undefined
  if (composition) return { width: composition.width, height: composition.height }
  return project ?? { width: 1920, height: 1080 }
}

/** What a parent sees of the timeline: enough to plan edits, nothing the editor keeps private. */
export function readTimeline() {
  const { tracks, items } = useItemsStore.getState()
  const metadata = useProjectStore.getState().currentProject?.metadata
  const { mediaItems, mediaById } = useMediaLibraryStore.getState()
  const canvas = liveCanvas(metadata ?? null)
  const durationInFrames = items.reduce(
    (end, item) => Math.max(end, item.from + item.durationInFrames),
    0,
  )
  return {
    fps: useTimelineSettingsStore.getState().fps || metadata?.fps || 30,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    durationInFrames,
    currentFrame: usePlaybackStore.getState().currentFrame,
    tracks: tracks.map(reportTrack),
    items: items.map((item) => reportItem(item, canvas, mediaById)),
    media: mediaItems.map((media) => ({
      id: media.id,
      fileName: media.fileName,
      mimeType: media.mimeType,
      duration: media.duration,
      width: media.width,
      height: media.height,
      fps: media.fps,
    })),
    markers: useMarkersStore.getState().markers.map((marker) => ({
      id: marker.id,
      frame: marker.frame,
      label: marker.label ?? '',
      color: marker.color,
    })),
    sequences: readSequences(durationInFrames),
  }
}
