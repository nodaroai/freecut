import { createLogger } from '@/shared/logging/logger';
import { useEmbeddedStore } from '../stores/embedded-store';
import { roundToNearestAllowedFps } from '../utils/codec-mapping';
import { useProjectStore } from '../deps/projects-contract';
import { mediaLibraryService, mediaProcessorService } from '../deps/media-library-contract';
import { router } from '@/app/router';
import { updateProject as updateProjectDB, getProject as getProjectDB } from '@/infrastructure/storage/indexeddb';

const log = createLogger('embedded-message-handler');

const ALLOWED_ORIGINS = [
  'https://app.nodaro.ai',
  'https://next.nodaro.ai',
];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith('http://localhost:')) return true;
  if (origin.endsWith('.up.railway.app') && origin.startsWith('https://')) return true;
  return false;
}

function postToParent(message: unknown) {
  const { parentOrigin } = useEmbeddedStore.getState();
  if (parentOrigin) {
    window.parent.postMessage(message, parentOrigin);
  }
}

async function handleLoadVideo(event: MessageEvent) {
  const store = useEmbeddedStore.getState();

  // Guard: already importing
  if (store.isImporting) {
    log.warn('Import already in progress, ignoring duplicate NODARO_LOAD_VIDEO');
    return;
  }

  store.setIsImporting(true);

  try {
    // Store parent origin for outbound messages
    store.setParentOrigin(event.origin);

    const { videoUrl, videoBuffer } = event.data.payload;
    if (!videoUrl && !videoBuffer) {
      throw new Error('Missing videoUrl or videoBuffer in NODARO_LOAD_VIDEO payload');
    }

    // Use pre-fetched buffer if provided (avoids CORS), otherwise fetch URL
    let blob: Blob;
    if (videoBuffer) {
      log.info('Using pre-fetched video buffer', { size: videoBuffer.byteLength });
      blob = new Blob([videoBuffer], { type: 'video/mp4' });
    } else {
      log.info('Fetching video from:', videoUrl);
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      blob = await response.blob();
    }

    // Extract metadata via worker
    const file = new File([blob], 'nodaro-edit.mp4', { type: blob.type || 'video/mp4' });
    const { metadata: workerMeta } = await mediaProcessorService.processMedia(file, file.type);

    const fps = roundToNearestAllowedFps(workerMeta.type === 'video' ? workerMeta.fps : 30);
    const width = 'width' in workerMeta ? workerMeta.width : 1920;
    const height = 'height' in workerMeta ? workerMeta.height : 1080;

    const inputMeta = {
      codec: workerMeta.type === 'video' ? workerMeta.codec : '',
      width,
      height,
      fps: workerMeta.type === 'video' ? workerMeta.fps : 30,
    };

    // Always create fresh project and import media first
    const project = await useProjectStore.getState().createProject({
      name: 'Nodaro Edit',
      width,
      height,
      fps,
      backgroundColor: '#000000',
    });

    const media = await mediaLibraryService.importMediaBlob(blob, project.id, 'nodaro-edit.mp4');

    // If we have a saved project snapshot, restore the timeline onto the fresh project
    let timelineRestored = false;
    const { projectJson } = event.data.payload;
    if (projectJson) {
      try {
        const snapshot = typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson;
        const savedTimeline = snapshot.project?.timeline;
        if (savedTimeline?.items) {
          // Collect all old media IDs referenced in saved timeline
          const oldMediaIds = new Set<string>();
          for (const item of savedTimeline.items) {
            if (item.mediaId) oldMediaIds.add(item.mediaId);
          }

          // Remap old media IDs to the new media ID
          const restoredTimeline = {
            ...savedTimeline,
            items: savedTimeline.items.map((item: Record<string, unknown>) => {
              if (item.mediaId && oldMediaIds.has(item.mediaId as string)) {
                return { ...item, mediaId: media.id, src: undefined, thumbnailUrl: undefined };
              }
              return item;
            }),
          };

          // Update the fresh project with restored timeline in both DB and Zustand store
          await updateProjectDB(project.id, { timeline: restoredTimeline, updatedAt: Date.now() });
          const updatedProject = await getProjectDB(project.id);
          if (updatedProject) {
            useProjectStore.setState({
              currentProject: updatedProject,
              projects: useProjectStore.getState().projects.map((p) =>
                p.id === project.id ? updatedProject : p,
              ),
            });
          }
          log.info('Timeline restored from snapshot', { projectId: project.id, remappedMediaIds: oldMediaIds.size });
          // Don't set pendingVideoImport — restored timeline already has the video
          timelineRestored = true;
        }
      } catch (e) {
        log.warn('Failed to restore timeline from snapshot, using fresh project', { error: e });
      }
    }

    // Only add video to timeline for fresh projects (restored ones already have it)
    if (!timelineRestored) {
      store.setPendingVideoImport({ mediaId: media.id });
    }
    store.setInputMetadata(inputMeta);

    // Import additional connected assets into the media library (e.g. manual-edit multi-input)
    const { additionalFiles } = event.data.payload;
    if (additionalFiles?.length) {
      for (const file of additionalFiles) {
        try {
          const fileBlob = new Blob([file.buffer], { type: file.type });
          await mediaLibraryService.importMediaBlob(fileBlob, project.id, file.name);
        } catch (e) {
          log.warn(`Failed to import additional asset ${file.name}:`, e);
        }
      }
      log.info('Additional assets imported', { count: additionalFiles.length });
    }

    router.navigate({
      to: '/editor/$projectId',
      params: { projectId: project.id },
    });

    log.info('Video import complete, navigating to editor', { projectId: project.id, mediaId: media.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown import error';
    log.error('Failed to handle NODARO_LOAD_VIDEO:', error);
    postToParent({ type: 'FREECUT_ERROR', payload: { phase: 'import', message } });
  } finally {
    useEmbeddedStore.getState().setIsImporting(false);
  }
}

function handleResetProject() {
  const store = useEmbeddedStore.getState();

  // Re-import with the original video but no project JSON
  // The parent will re-send NODARO_LOAD_VIDEO without projectJson
  log.info('Reset project requested, waiting for fresh NODARO_LOAD_VIDEO');

  // Clear the importing flag so the next NODARO_LOAD_VIDEO is accepted
  store.setIsImporting(false);
}

async function handleImportFiles(event: MessageEvent) {
  const { files } = event.data.payload;
  if (!files?.length) return;

  const projectId = useProjectStore.getState().currentProject?.id;
  if (!projectId) {
    log.warn('No current project for NODARO_IMPORT_FILES');
    return;
  }

  for (const file of files) {
    try {
      const blob = new Blob([file.buffer], { type: file.type });
      await mediaLibraryService.importMediaBlob(blob, projectId, file.name);
    } catch (e) {
      log.error(`Failed to import ${file.name}:`, e);
    }
  }

  // Refresh the media library UI (lazy-import to avoid circular deps)
  try {
    const { useMediaLibraryStore } = await import(
      '../deps/media-library-contract'
    );
    await useMediaLibraryStore.getState().loadMediaItems();
  } catch (e) {
    log.warn('Failed to refresh media library after import:', e);
  }
}

function handleMessage(event: MessageEvent) {
  if (event.data?.type === 'NODARO_LOAD_VIDEO') {
    if (!isAllowedOrigin(event.origin)) {
      log.warn('Rejected message from disallowed origin:', event.origin);
      return;
    }
    handleLoadVideo(event);
  }

  if (event.data?.type === 'NODARO_RESET_PROJECT') {
    if (!isAllowedOrigin(event.origin)) {
      log.warn('Rejected NODARO_RESET_PROJECT from disallowed origin:', event.origin);
      return;
    }
    handleResetProject();
  }

  if (event.data?.type === 'NODARO_IMPORT_FILES') {
    if (!isAllowedOrigin(event.origin)) {
      log.warn('Rejected NODARO_IMPORT_FILES from disallowed origin:', event.origin);
      return;
    }
    handleImportFiles(event);
  }
}

export function initEmbeddedMessageHandler() {
  window.addEventListener('message', handleMessage);
  // Signal readiness to parent (uses '*' because parent origin unknown yet, no sensitive payload)
  window.parent.postMessage({ type: 'FREECUT_READY' }, '*');
  log.info('Embedded message handler initialized, FREECUT_READY sent');
}
