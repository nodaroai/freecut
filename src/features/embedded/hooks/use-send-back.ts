import { useEffect, useCallback } from 'react';
import { useClientRender } from '../deps/export-contract';
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

    result.blob.arrayBuffer().then((buffer) => {
      window.parent.postMessage(
        { type: 'FREECUT_EXPORT_COMPLETE', payload: { videoBuffer: buffer } },
        parentOrigin,
      );
      log.info('Export result sent to parent', {
        fileSize: result.fileSize,
        mimeType: result.mimeType,
      });
      useEmbeddedStore.getState().setSendBackStatus('sent');
      setTimeout(() => {
        useEmbeddedStore.getState().setSendBackStatus('idle');
      }, 3000);
    });
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
