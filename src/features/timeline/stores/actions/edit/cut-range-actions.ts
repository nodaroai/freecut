import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { emitUiSound } from '@/shared/ui/ui-sound'
import { useItemsStore } from '../../items-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useMarkersStore } from '../../markers-store'
import { useTransitionsStore } from '../../transitions-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import {
  pruneEmptyLayerGroupHierarchy,
  resolveEffectiveTrackStates,
} from '../../../utils/group-utils'
import { execute, applyTransitionRepairs } from '../shared'
import { applySplitBookkeeping, type SplitResultEntry } from '../split-bookkeeping'
import { isInTransitionOverlap } from './shared'

function getUncuttableTrackIds(): Set<string> {
  return new Set(
    resolveEffectiveTrackStates(useItemsStore.getState().tracks)
      .filter((track) => track.locked || track.isGroup)
      .map((track) => track.id),
  )
}

function hasTransitionAtFrame(frame: number, skipTrackIds: ReadonlySet<string>): boolean {
  return useItemsStore
    .getState()
    .items.some(
      (item) =>
        !skipTrackIds.has(item.trackId) &&
        frame > item.from &&
        frame < item.from + item.durationInFrames &&
        isInTransitionOverlap(item.id, frame - item.from, item.durationInFrames),
    )
}

function splitCuttableItemsAtFrame(
  frame: number,
  skipTrackIds: ReadonlySet<string>,
): SplitResultEntry[] {
  const crossing = useItemsStore
    .getState()
    .items.filter(
      (item) =>
        !skipTrackIds.has(item.trackId) &&
        frame > item.from &&
        frame < item.from + item.durationInFrames,
    )

  const splitResults: SplitResultEntry[] = []
  for (const item of crossing) {
    const result = useItemsStore.getState()._splitItem(item.id, frame)
    if (result) {
      splitResults.push({
        originalId: item.id,
        originalLinkedGroupId: item.linkedGroupId,
        result,
      })
    }
  }

  if (splitResults.length > 0) {
    applySplitBookkeeping(splitResults)
    for (const entry of splitResults) {
      applyTransitionRepairs([entry.result.leftItem.id, entry.result.rightItem.id])
    }
  }

  return splitResults
}

/**
 * Cut the marked in/out range out of the timeline in one undoable step —
 * the Camtasia-style range cut. Every unlocked clip is split at both
 * boundaries, whatever falls inside the range is removed, and the gap is
 * closed by shifting everything to the right of the out point left. Markers
 * inside the range go with it; later markers shift with the content. Locked
 * tracks are left untouched. Clears the in/out range and parks the playhead
 * at the seam when done.
 */
export function cutInOutRange(): boolean {
  const { inPoint, outPoint } = useMarkersStore.getState()
  if (inPoint === null || outPoint === null) {
    return false
  }

  const rangeStart = Math.min(inPoint, outPoint)
  const rangeEnd = Math.max(inPoint, outPoint)
  const cutLength = rangeEnd - rangeStart
  if (cutLength <= 0) {
    return false
  }

  const skipTrackIds = getUncuttableTrackIds()
  if (
    hasTransitionAtFrame(rangeStart, skipTrackIds) ||
    hasTransitionAtFrame(rangeEnd, skipTrackIds)
  ) {
    toast.warning(i18n.t('timeline.header.cutRangeTransitionBlocked'))
    emitUiSound('error')
    return false
  }

  execute(
    'CUT_IN_OUT_RANGE',
    () => {
      // Split out first, then in: left pieces keep the original ids, so the
      // second split still sees valid items around the in point.
      const outSplits = splitCuttableItemsAtFrame(rangeEnd, skipTrackIds)
      const inSplits = splitCuttableItemsAtFrame(rangeStart, skipTrackIds)

      // The seam is a hard cut: pieces created by the boundary splits lose the
      // fade that now sits on an inner edge (mirrors SPLIT_ITEM_MULTI).
      for (const entry of outSplits) {
        useItemsStore.getState()._updateItem(entry.result.rightItem.id, { fadeIn: 0 })
      }
      for (const entry of inSplits) {
        useItemsStore.getState()._updateItem(entry.result.leftItem.id, { fadeOut: 0 })
      }

      const store = useItemsStore.getState()
      const removedIds = store.items
        .filter(
          (item) =>
            !skipTrackIds.has(item.trackId) &&
            item.from >= rangeStart &&
            item.from + item.durationInFrames <= rangeEnd,
        )
        .map((item) => item.id)

      if (removedIds.length > 0) {
        store._removeItems(removedIds)
        useTransitionsStore.getState()._removeTransitionsForItems(removedIds)
        useKeyframesStore.getState()._removeKeyframesForItems(removedIds)
      }

      // Close the gap: the removed interval is identical on every track, so a
      // uniform left shift of everything past the out point stitches cleanly.
      const shiftedItems = useItemsStore
        .getState()
        .items.filter((item) => !skipTrackIds.has(item.trackId) && item.from >= rangeEnd)
      for (const item of shiftedItems) {
        useItemsStore.getState()._updateItem(item.id, { from: item.from - cutLength })
      }

      // Markers travel with the content; the range's own markers are cut too.
      const markersStore = useMarkersStore.getState()
      const nextMarkers = markersStore.markers
        .filter((marker) => marker.frame < rangeStart || marker.frame >= rangeEnd)
        .map((marker) =>
          marker.frame >= rangeEnd ? { ...marker, frame: marker.frame - cutLength } : marker,
        )
      markersStore.setMarkers(nextMarkers)
      markersStore.clearInOutPoints()

      const currentTracks = useItemsStore.getState().tracks
      const prunedTracks = pruneEmptyLayerGroupHierarchy(
        currentTracks,
        useItemsStore.getState().items,
      )
      if (prunedTracks !== currentTracks) {
        useItemsStore.getState().setTracks(prunedTracks)
      }

      useSelectionStore.getState().selectItems([])
      useTimelineSettingsStore.getState().markDirty()
    },
    { inPoint: rangeStart, outPoint: rangeEnd },
  )

  usePlaybackStore.getState().setCurrentFrame(rangeStart)
  emitUiSound('delete')
  return true
}
