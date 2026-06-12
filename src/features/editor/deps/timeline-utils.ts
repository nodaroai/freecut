/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export type { ScrubThrottleState } from './timeline-contract'
export {
  createDefaultAdjustmentItem,
  createScrubThrottleState,
  shouldCommitScrubFrame,
  createDefaultShapeItem,
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
  getTrackKind,
  resolveEffectiveTrackStates,
  getMaxTransitionDurationForHandles,
  resolveTransitionTargetFromSelection,
  timelineToSourceFrames,
  sourceToTimelineFrames,
  linkItems,
} from './timeline-contract'
