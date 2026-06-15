/**
 * Adapter exports for keyframe editor UI used by lazy timeline panels.
 */

export {
  DopesheetEditor,
  getAnimatablePropertiesForItem,
  getEffectPropertyBaseValue,
  captureAnimationFromItem,
  getPresetCompatibility,
} from './keyframes-contract'
export type {
  CapturedAnimation,
  PresetCompatibility,
  PresetIncompatibilityReason,
} from './keyframes-contract'
