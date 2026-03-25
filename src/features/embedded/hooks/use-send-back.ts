import { useEffect, useCallback } from 'react';
import { useClientRender } from '../deps/export-contract';
import { useProjectStore } from '../deps/projects-contract';
import { exportProjectJson } from '../deps/project-bundle-contract';
import { useEmbeddedStore } from '../stores/embedded-store';
import { reverseMapCodec } from '../utils/codec-mapping';
import { createLogger } from '@/shared/logging/logger';
import type { ExtendedExportSettings } from '@/types/export';

const log = createLogger('Embedded:SendBack');

export function useSendBack() {
  const { startExport, progress, status, result, error, isExporting } = useClientRender();
  const parentOrigin = useEmbeddedStore((s) => s.parentOrigin);
  const inputMetadata = useEmbeddedStore((s) => s.inputMetadata);
  const sendBackStatus = useEmbeddedStore((s) => s.sendBackStatus);

  // Report progress to parent
  useEffect(() => {
    if (!parentOrigin) return;
    if (
      status === 'rendering' ||
      status === 'encoding' ||
      status === 'preparing' ||
      status === 'finalizing'
    ) {
      window.parent.postMessage(
        { type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: progress / 100 } },
        parentOrigin,
      );
      useEmbeddedStore.getState().setExportProgress(progress / 100);
    }
  }, [progress, status, parentOrigin]);

  // Send completed result to parent
  useEffect(() => {
    if (!parentOrigin || status !== 'completed' || !result?.blob) return;

    (async () => {
      const buffer = await result.blob.arrayBuffer();

      // Save timeline to IndexedDB first, then export project JSON
      let projectJson: unknown = null;
      try {
        const currentProject = useProjectStore.getState().currentProject;
        if (currentProject) {
          // Force save timeline to DB before exporting (auto-save may not have flushed yet)
          const { getTimelineSnapshot } = await import('../deps/timeline-contract');
          const snapshot = getTimelineSnapshot();
          if (snapshot.saveTimeline) {
            await snapshot.saveTimeline(currentProject.id);
          }

          projectJson = await exportProjectJson(currentProject.id, {
            includeMediaReferences: true,
            stripVolatileFields: true,
            includeChecksum: false,
          });
        }
      } catch (e) {
        log.warn('Failed to export project JSON for send-back', { error: e });
      }

      window.parent.postMessage(
        { type: 'FREECUT_EXPORT_COMPLETE', payload: { videoBuffer: buffer, projectJson } },
        parentOrigin,
        [buffer],
      );
      log.info('Export result sent to parent', {
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        hasProjectJson: !!projectJson,
      });
      useEmbeddedStore.getState().setSendBackStatus('sent');
      setTimeout(() => {
        useEmbeddedStore.getState().setSendBackStatus('idle');
      }, 3000);
    })();
  }, [status, result, parentOrigin]);

  // Report errors to parent
  useEffect(() => {
    if (!parentOrigin || status !== 'failed' || !error) return;

    window.parent.postMessage(
      { type: 'FREECUT_ERROR', payload: { phase: 'export', message: error } },
      parentOrigin,
    );
    log.error('Export failed', { error });
    useEmbeddedStore.getState().setSendBackStatus('error');
  }, [status, error, parentOrigin]);

  const sendBack = useCallback(async () => {
    if (!inputMetadata) {
      log.warn('sendBack called without inputMetadata');
      return;
    }

    useEmbeddedStore.getState().setSendBackStatus('exporting');

    const settings: ExtendedExportSettings = {
      codec: reverseMapCodec(inputMetadata.codec),
      quality: 'high',
      resolution: { width: inputMetadata.width, height: inputMetadata.height },
      mode: 'video',
      videoContainer: 'mp4',
      renderWholeProject: true,
    };

    log.info('Starting send-back export', {
      codec: settings.codec,
      resolution: `${inputMetadata.width}x${inputMetadata.height}`,
    });

    await startExport(settings);
  }, [inputMetadata, startExport]);

  return {
    sendBack,
    isExporting,
    progress,
    sendBackStatus,
  };
}
