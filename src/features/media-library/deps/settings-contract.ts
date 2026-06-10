/**
 * Adapter — re-exports settings store for media-library consumption.
 */

export {
  useSettingsStore,
  resolveCaptioningIntervalSec,
} from '@/features/settings/stores/settings-store'
export type { CaptioningIntervalUnit } from '@/features/settings/stores/settings-store'
