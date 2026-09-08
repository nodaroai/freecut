import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import { useEmbeddedStore } from '../stores/embedded-store'
import { roundToNearestAllowedFps } from '../utils/codec-mapping'
import { useProjectStore } from '../deps/projects-contract'
import { mediaLibraryService, mediaProcessorService } from '../deps/media-library-contract'
import { router } from '@/app/router'
import { ensureEmbeddedWorkspaceMounted } from './embedded-workspace'
import {
  updateProject as updateProjectDB,
  getProject as getProjectDB,
} from '@/infrastructure/storage'

const log = createLogger('embedded-message-handler')

const ALLOWED_ORIGINS = [
  'https://app.nodaro.ai',
  'https://next.nodaro.ai',
  'https://studio.nodaro.ai',
  'https://next.studio.nodaro.ai',
]

export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (origin.startsWith('http://localhost:')) return true
  if (origin.endsWith('.up.railway.app') && origin.startsWith('https://')) return true
  return false
}

function postToParent(message: unknown) {
  const { parentOrigin } = useEmbeddedStore.getState()
  if (parentOrigin) {
    window.parent.postMessage(message, parentOrigin)
  }
}

// Primary clip's file/display name in the media bin — parents that name their
// clips (e.g. Studio's "Shot 1.mp4") pass payload.videoName; absent keeps the legacy name.
export function resolvePrimaryVideoName(videoName: unknown): string {
  return typeof videoName === 'string' && videoName.trim() ? videoName.trim() : 'nodaro-edit.mp4'
}

// A NODARO_LOAD_VIDEO with no primary video is the EMPTY-BOOT request
// (standalone hosts like Studio's /editor): open a fresh empty project and let
// the parent-bridged Import fill the media bin. Kept as a pure predicate so the
// contract is pinned by a test.
export function isEmptyBootPayload(payload: {
  videoUrl?: unknown
  videoBuffer?: unknown
}): boolean {
  return !payload.videoUrl && !payload.videoBuffer
}

// Use pre-fetched buffer if provided (avoids CORS), otherwise fetch URL
async function fetchPrimaryBlob(
  videoUrl: string,
  videoBuffer: ArrayBuffer | undefined,
): Promise<Blob> {
  if (videoBuffer) {
    log.info('Using pre-fetched video buffer', { size: videoBuffer.byteLength })
    return new Blob([videoBuffer], { type: 'video/mp4' })
  }
  log.info('Fetching video from:', videoUrl)
  const response = await fetch(videoUrl)
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
  return response.blob()
}

// Extract metadata via worker; canvas dimensions fall back to 1080p
async function probeInputMetadata(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: blob.type || 'video/mp4' })
  const { metadata: workerMeta } = await mediaProcessorService.processMedia(file, file.type)

  const width = 'width' in workerMeta ? workerMeta.width : 1920
  const height = 'height' in workerMeta ? workerMeta.height : 1080
  const sourceFps = workerMeta.type === 'video' ? workerMeta.fps : 30

  return {
    width,
    height,
    fps: roundToNearestAllowedFps(sourceFps),
    inputMeta: {
      codec: workerMeta.type === 'video' ? workerMeta.codec : '',
      width,
      height,
      fps: sourceFps,
    },
  }
}

// Remap old media ids in saved timeline items onto the newly imported media id.
function remapTimelineItems(
  items: ReadonlyArray<Record<string, unknown>>,
  mediaId: string,
): { items: Array<Record<string, unknown>>; remappedCount: number } {
  // Collect all old media IDs referenced in saved timeline
  const oldMediaIds = new Set<string>()
  for (const item of items) {
    if (item.mediaId) oldMediaIds.add(item.mediaId as string)
  }

  const remapped = items.map((item) => {
    if (item.mediaId && oldMediaIds.has(item.mediaId as string)) {
      return { ...item, mediaId, src: undefined, thumbnailUrl: undefined }
    }
    return item
  })
  return { items: remapped, remappedCount: oldMediaIds.size }
}

// Restore a saved project snapshot's timeline onto the fresh project, remapping
// old media ids to the newly imported media. Returns true when restored.
async function restoreTimelineSnapshot(
  event: MessageEvent,
  projectId: string,
  mediaId: string,
): Promise<boolean> {
  const { projectJson } = event.data.payload
  if (!projectJson) return false

  try {
    const parsed = typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson
    if (!parsed?.project) return false

    // Snapshots can predate schema bumps (saved by an older editor build). Bring
    // them to the current schema before grafting the timeline onto the fresh
    // project — the fresh project is already at the current version, so the
    // editor's own migration gate never sees this data.
    const snapshot = { ...parsed, project: migrateProject(parsed.project).project }

    const savedTimeline = snapshot.project?.timeline
    if (!savedTimeline?.items) return false

    const { items, remappedCount } = remapTimelineItems(savedTimeline.items, mediaId)
    const restoredTimeline = { ...savedTimeline, items }

    // Update the fresh project with restored timeline in both DB and Zustand store
    await updateProjectDB(projectId, { timeline: restoredTimeline, updatedAt: Date.now() })
    const updatedProject = await getProjectDB(projectId)
    if (updatedProject) {
      useProjectStore.setState({
        currentProject: updatedProject,
        projects: useProjectStore
          .getState()
          .projects.map((p) => (p.id === projectId ? updatedProject : p)),
      })
    }
    log.info('Timeline restored from snapshot', {
      projectId,
      remappedMediaIds: remappedCount,
    })
    return true
  } catch (e) {
    log.warn('Failed to restore timeline from snapshot, using fresh project', { error: e })
    return false
  }
}

// Import additional connected assets into the media library (e.g. manual-edit multi-input)
async function importAdditionalAssets(event: MessageEvent, projectId: string) {
  const { additionalFiles } = event.data.payload
  if (!additionalFiles?.length) return

  for (const file of additionalFiles) {
    try {
      const fileBlob = new Blob([file.buffer], { type: file.type })
      await mediaLibraryService.importMediaBlob(fileBlob, projectId, file.name)
    } catch (e) {
      log.warn(`Failed to import additional asset ${file.name}:`, e)
    }
  }
  log.info('Additional assets imported', { count: additionalFiles.length })

  // Refresh media library UI so additional assets appear immediately
  try {
    const { useMediaLibraryStore } = await import('../deps/media-library-contract')
    await useMediaLibraryStore.getState().loadMediaItems()
  } catch (e) {
    log.warn('Failed to refresh media library after additional imports:', e)
  }
}

async function handleLoadVideo(event: MessageEvent) {
  const store = useEmbeddedStore.getState()

  // Guard: already importing
  if (store.isImporting) {
    log.warn('Import already in progress, ignoring duplicate NODARO_LOAD_VIDEO')
    return
  }

  store.setIsImporting(true)

  try {
    // Embedded has no folder picker — mount OPFS as the workspace root before any storage op.
    await ensureEmbeddedWorkspaceMounted()

    // Store parent origin for outbound messages
    store.setParentOrigin(event.origin)

    const { videoUrl, videoBuffer, videoName } = event.data.payload
    if (isEmptyBootPayload(event.data.payload)) {
      // EMPTY BOOT — no primary video: a standalone host opens the editor on a
      // fresh empty project (media bin fills via the parent-bridged Import).
      // Was a hard error before standalone hosts existed.
      const project = await useProjectStore.getState().createProject({
        name: 'Nodaro Edit',
        width: 1920,
        height: 1080,
        fps: 30,
        backgroundColor: '#000000',
      })
      await importAdditionalAssets(event, project.id)
      router.navigate({
        to: '/editor/$projectId',
        params: { projectId: project.id },
      })
      log.info('Empty-boot: opened a fresh project with no primary video', {
        projectId: project.id,
      })
      return
    }

    const primaryName = resolvePrimaryVideoName(videoName)
    const blob = await fetchPrimaryBlob(videoUrl, videoBuffer)
    const { width, height, fps, inputMeta } = await probeInputMetadata(blob, primaryName)

    // Always create fresh project and import media first
    const project = await useProjectStore.getState().createProject({
      name: 'NodarCut Edit',
      width,
      height,
      fps,
      backgroundColor: '#000000',
    })

    const media = await mediaLibraryService.importMediaBlob(blob, project.id, primaryName)

    // Only add video to timeline for fresh projects (restored ones already have it)
    const timelineRestored = await restoreTimelineSnapshot(event, project.id, media.id)
    if (!timelineRestored) {
      store.setPendingVideoImport({ mediaId: media.id })
    }
    store.setInputMetadata(inputMeta)

    await importAdditionalAssets(event, project.id)

    router.navigate({
      to: '/editor/$projectId',
      params: { projectId: project.id },
    })

    log.info('Video import complete, navigating to editor', {
      projectId: project.id,
      mediaId: media.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown import error'
    log.error('Failed to handle NODARO_LOAD_VIDEO:', error)
    postToParent({ type: 'FREECUT_ERROR', payload: { phase: 'import', message } })
  } finally {
    useEmbeddedStore.getState().setIsImporting(false)
  }
}

function handleResetProject() {
  const store = useEmbeddedStore.getState()

  // Re-import with the original video but no project JSON
  // The parent will re-send NODARO_LOAD_VIDEO without projectJson
  log.info('Reset project requested, waiting for fresh NODARO_LOAD_VIDEO')

  // Clear the importing flag so the next NODARO_LOAD_VIDEO is accepted
  store.setIsImporting(false)
}

async function handleImportFiles(event: MessageEvent) {
  const { files } = event.data.payload
  if (!files?.length) return

  await ensureEmbeddedWorkspaceMounted()

  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) {
    log.warn('No current project for NODARO_IMPORT_FILES')
    return
  }

  for (const file of files) {
    try {
      const blob = new Blob([file.buffer], { type: file.type })
      await mediaLibraryService.importMediaBlob(blob, projectId, file.name)
    } catch (e) {
      log.error(`Failed to import ${file.name}:`, e)
    }
  }

  // Refresh the media library UI (lazy-import to avoid circular deps)
  try {
    const { useMediaLibraryStore } = await import('../deps/media-library-contract')
    await useMediaLibraryStore.getState().loadMediaItems()
  } catch (e) {
    log.warn('Failed to refresh media library after import:', e)
  }
}

// Inbound message types the embedded editor accepts, each behind the origin allowlist.
const EMBEDDED_MESSAGE_HANDLERS: Record<string, (event: MessageEvent) => void | Promise<void>> = {
  NODARO_LOAD_VIDEO: handleLoadVideo,
  NODARO_RESET_PROJECT: () => handleResetProject(),
  NODARO_IMPORT_FILES: handleImportFiles,
}

function handleMessage(event: MessageEvent) {
  const type = event.data?.type
  const handler = type ? EMBEDDED_MESSAGE_HANDLERS[type] : undefined
  if (!handler) return

  if (!isAllowedOrigin(event.origin)) {
    log.warn(`Rejected ${type} from disallowed origin:`, event.origin)
    return
  }

  void handler(event)
}

export function initEmbeddedMessageHandler() {
  // Warm the OPFS workspace mount so it's ready before the parent sends a video.
  void ensureEmbeddedWorkspaceMounted()
  window.addEventListener('message', handleMessage)
  // Signal readiness to parent (uses '*' because parent origin unknown yet, no sensitive payload)
  window.parent.postMessage({ type: 'FREECUT_READY' }, '*')
  log.info('Embedded message handler initialized, FREECUT_READY sent')
}
