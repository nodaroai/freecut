import { createLogger } from '@/shared/logging/logger'
import { useEmbeddedStore } from '@/features/editor/deps/embedded-contract'
import { useProjectStore } from '@/features/editor/deps/projects-contract'

const log = createLogger('embedded-import')

/** The videos being placed now. */
const placing = new Set<string>()

export async function consumePendingEmbeddedImport(): Promise<void> {
  const pending = useEmbeddedStore.getState().pendingVideoImport
  if (!pending) return
  const { mediaId } = pending
  // The editor can ask again while the first placement is still loading: two
  // placements put the same video on the timeline twice, one over the other
  // (every cut then splits both and leaves gaps). One placement per video.
  if (placing.has(mediaId)) return
  placing.add(mediaId)

  try {
    // Lazy imports to avoid pulling into main bundle
    const { resolveMediaUrl, importMediaLibraryService } =
      await import('@/features/editor/deps/media-library-contract')
    const mediaLibraryModule = await importMediaLibraryService()
    const { mediaLibraryService } = mediaLibraryModule
    const { addItem, addItemWithLinkedAudio, useItemsStore } =
      await import('@/features/editor/deps/timeline-store')
    const { buildDroppedMediaTimelineItem, getDroppedMediaDurationInFrames } =
      await import('@/features/editor/deps/timeline-motion')

    // Read from IndexedDB directly (store may not be populated yet)
    const metadata = await mediaLibraryService.getMedia(mediaId)
    if (!metadata) {
      log.error('Media not found in IndexedDB', { mediaId })
      return
    }

    // Get blob URL via existing resolver (handles OPFS + ref counting)
    const blobUrl = await resolveMediaUrl(mediaId)
    if (!blobUrl) {
      log.error('Failed to resolve media URL', { mediaId })
      return
    }

    // Get thumbnail URL
    const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId)

    // Already on the timeline (placed by an earlier request): nothing to add.
    if (useItemsStore.getState().items.some((item) => item.mediaId === mediaId)) {
      log.info('Embedded video already on the timeline', { mediaId })
      return
    }

    // Get track + project context
    const tracks = useItemsStore.getState().tracks
    if (tracks.length === 0) {
      log.error('No tracks available after loadTimeline')
      return
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      log.error('No current project')
      return
    }

    const fps = project.metadata.fps
    const durationInFrames = getDroppedMediaDurationInFrames(metadata, 'video', fps)

    // Find first non-group track for item placement
    const targetTrack = tracks.find((t) => !t.isGroup)
    if (!targetTrack) {
      log.error('No non-group track available for item placement')
      return
    }

    const videoItem = buildDroppedMediaTimelineItem({
      media: metadata,
      mediaId: metadata.id,
      mediaType: 'video',
      label: metadata.fileName,
      timelineFps: fps,
      blobUrl,
      thumbnailUrl,
      canvasWidth: project.metadata.width,
      canvasHeight: project.metadata.height,
      placement: {
        trackId: targetTrack.id,
        from: 0,
        durationInFrames,
      },
    })

    // Same contract as a media-bin drop: a video whose media has an audio
    // stream gets its embedded audio split onto a linked audio item, so the
    // auto-placed primary is never silent.
    const hasLinkedAudio = videoItem.type === 'video' && !!metadata.audioCodec
    if (videoItem.type === 'video' && metadata.audioCodec) {
      addItemWithLinkedAudio(videoItem)
    } else {
      addItem(videoItem)
    }
    log.info('Placed embedded video on timeline', { mediaId, durationInFrames, hasLinkedAudio })
  } catch (error) {
    log.error('Failed to consume pending embedded import', { error })
  } finally {
    placing.delete(mediaId)
    useEmbeddedStore.getState().setPendingVideoImport(null)
  }
}
