import { registerMediaRelinkingTimelineActions } from '../stores/media-relinking-timeline-actions'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { getSynchronizedLinkedItems } from '@/features/timeline/utils/linked-items'
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  renameCompoundClip,
  updateProjectItem,
} from '@/features/timeline/stores/timeline-actions'

const unregisterMediaRelinkingTimelineActions = registerMediaRelinkingTimelineActions({
  removeProjectItems,
  updateProjectItem,
  getItemsState: () => {
    const { items, itemById } = useItemsStore.getState()
    return { items, itemById }
  },
  getFps: () => useTimelineSettingsStore.getState().fps,
  getSynchronizedLinkedItems,
})

if (import.meta.hot) {
  import.meta.hot.dispose(unregisterMediaRelinkingTimelineActions)
}

export {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  renameCompoundClip,
}
