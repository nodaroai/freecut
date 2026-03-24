import { createLogger } from '@/shared/logging/logger';
import { useEmbeddedStore } from '../stores/embedded-store';
import { roundToNearestAllowedFps } from '../utils/codec-mapping';
import { useProjectStore } from '../deps/projects-contract';
import { mediaLibraryService, mediaProcessorService } from '../deps/media-library-contract';
import { router } from '@/app/router';

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

    const { videoUrl } = event.data.payload;
    if (!videoUrl) {
      throw new Error('Missing videoUrl in NODARO_LOAD_VIDEO payload');
    }

    // Fetch video
    log.info('Fetching video from:', videoUrl);
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const blob = await response.blob();

    // Extract metadata via worker
    const file = new File([blob], 'nodaro-edit.mp4', { type: blob.type || 'video/mp4' });
    const { metadata: workerMeta } = await mediaProcessorService.processMedia(file, file.type);

    // Create project using video dimensions/fps
    const fps = roundToNearestAllowedFps(workerMeta.type === 'video' ? workerMeta.fps : 30);
    const width = 'width' in workerMeta ? workerMeta.width : 1920;
    const height = 'height' in workerMeta ? workerMeta.height : 1080;

    const project = await useProjectStore.getState().createProject({
      name: 'Nodaro Edit',
      width,
      height,
      fps,
      backgroundColor: '#000000',
    });

    // Import to media library
    const media = await mediaLibraryService.importMediaBlob(blob, project.id, 'nodaro-edit.mp4');

    // Store pending import + input metadata
    store.setPendingVideoImport({ mediaId: media.id });
    store.setInputMetadata({
      codec: workerMeta.type === 'video' ? workerMeta.codec : '',
      width,
      height,
      fps: workerMeta.type === 'video' ? workerMeta.fps : 30,
    });

    // Navigate to editor
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

function handleMessage(event: MessageEvent) {
  if (event.data?.type === 'NODARO_LOAD_VIDEO') {
    // Validate origin before any processing
    if (!isAllowedOrigin(event.origin)) {
      log.warn('Rejected message from disallowed origin:', event.origin);
      return;
    }
    handleLoadVideo(event);
  }
}

export function initEmbeddedMessageHandler() {
  window.addEventListener('message', handleMessage);
  // Signal readiness to parent (uses '*' because parent origin unknown yet, no sensitive payload)
  window.parent.postMessage({ type: 'FREECUT_READY' }, '*');
  log.info('Embedded message handler initialized, FREECUT_READY sent');
}
