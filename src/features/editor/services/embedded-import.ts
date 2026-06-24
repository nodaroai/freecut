import { createLogger } from '@/shared/logging/logger'
import { useEmbeddedStore } from '@/features/editor/deps/embedded-contract'
import { useProjectStore } from '@/features/editor/deps/projects-contract'

const log = createLogger('embedded-import')

export async function consumePendingEmbeddedImport(): Promise<void> {
  const state = useEmbeddedStore.getState()
  // PRODUCTION (NODARO_LOAD_TIMELINE): an ordered list of clip media ids to lay
  // end-to-end. SINGLE (NODARO_LOAD_VIDEO): one media id at frame 0. Both flow
  // through the same placement loop; the timeline list takes precedence when
  // both are queued.
  const mediaIds =
    state.pendingTimelineImport?.mediaIds ??
    (state.pendingVideoImport ? [state.pendingVideoImport.mediaId] : [])
  if (mediaIds.length === 0) return

  try {
    // Lazy imports to avoid pulling into main bundle
    const { resolveMediaUrl, importMediaLibraryService } =
      await import('@/features/editor/deps/media-library-contract')
    const mediaLibraryModule = await importMediaLibraryService()
    const { mediaLibraryService } = mediaLibraryModule
    const {
      addItem,
      buildDroppedMediaTimelineItem,
      getDroppedMediaDurationInFrames,
      useItemsStore,
    } = await import('@/features/editor/deps/timeline-contract')

    // Track + project context is shared across all clips.
    const tracks = useItemsStore.getState().tracks
    if (tracks.length === 0) {
      log.error('No tracks available after loadTimeline')
      return
    }

    // Find first non-group track for item placement
    const targetTrack = tracks.find((t) => !t.isGroup)
    if (!targetTrack) {
      log.error('No non-group track available for item placement')
      return
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      log.error('No current project')
      return
    }

    const fps = project.metadata.fps

    // Lay each clip sequentially. `cursor` only advances on a successful
    // placement, so a clip that fails to resolve is skipped (logged) without
    // leaving a gap and without aborting the rest of the assembly.
    let cursor = 0
    let placed = 0
    for (const mediaId of mediaIds) {
      // Read from IndexedDB directly (store may not be populated yet)
      const metadata = await mediaLibraryService.getMedia(mediaId)
      if (!metadata) {
        log.error('Media not found', { mediaId })
        continue
      }

      // Get blob URL via existing resolver (handles OPFS + ref counting)
      const blobUrl = await resolveMediaUrl(mediaId)
      if (!blobUrl) {
        log.error('Failed to resolve media URL', { mediaId })
        continue
      }

      // Get thumbnail URL
      const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(mediaId)

      const durationInFrames = getDroppedMediaDurationInFrames(metadata, 'video', fps)

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
          from: cursor,
          durationInFrames,
        },
      })

      addItem(videoItem)
      cursor += durationInFrames
      placed += 1
    }

    log.info('Placed embedded clips on timeline', {
      requested: mediaIds.length,
      placed,
      totalFrames: cursor,
    })
  } catch (error) {
    log.error('Failed to consume pending embedded import', { error })
  } finally {
    const store = useEmbeddedStore.getState()
    store.setPendingVideoImport(null)
    store.setPendingTimelineImport(null)
  }
}
