/**
 * Single import seam for media-library -> timeline dependencies.
 */

export type {
  AddMediaToTimelinePosition,
  SubComposition,
} from '@/features/timeline/contracts/media-library'
export {
  addMediaItemsToTimeline,
  autoMatchOrphanedClips,
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
  importCanvasRenderOrchestrator,
  resolveMediaUrl,
  resolveMediaUrls,
  useCompositionsStore,
} from '@/features/timeline/contracts/media-library'
