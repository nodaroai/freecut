import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MotionTimeViewport } from './motion-time-viewport-controller'
import type { AnimatableProperty, DirectLinkableProperty, ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'

export interface MotionDopesheetLanesProps {
  item: TimelineItem
  itemById: Record<string, TimelineItem>
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  compositionDurationInFrames: number
  fps: number
  canvas: { width: number; height: number }
  propertyFilter: 'all' | 'keyframed'
  timeViewport: MotionTimeViewport
  inlineCurveProperty: AnimatableProperty | null
  paneMode?: 'lanes' | 'graph'
  disabled?: boolean
  onSelectItem: (itemId: string) => void
  onInlineCurveChange: (property: AnimatableProperty | null) => void
  onScrub: (frame: number) => void
  onTimeViewportChange: (viewport: MotionTimeViewport) => void
  onPropertyLinkPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string,
    property: DirectLinkableProperty,
  ) => void
  onRemovePropertyLink?: (itemId: string, property: DirectLinkableProperty) => void
  onSetPropertyExpression?: (
    itemId: string,
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  onRemovePropertyExpression?: (itemId: string, property: DirectLinkableProperty) => void
}

function areItemsEqualForMotionDopesheet(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true

  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])
  for (const key of keys) {
    // Text-motion bands are rendered by TextMotionTimelineLanes. Their live
    // duration edits do not affect keyframes or base property values, so they
    // must not invalidate the much heavier dopesheet subtree.
    if (key === 'textMotion') continue
    if (previousRecord[key] !== nextRecord[key]) return false
  }
  return true
}

function arePresentationPropsEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    previous.compositionDurationInFrames === next.compositionDurationInFrames &&
    previous.fps === next.fps &&
    previous.propertyFilter === next.propertyFilter &&
    previous.inlineCurveProperty === next.inlineCurveProperty &&
    previous.paneMode === next.paneMode &&
    previous.disabled === next.disabled
  )
}

function areViewportPropsEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    previous.canvas.width === next.canvas.width &&
    previous.canvas.height === next.canvas.height &&
    previous.timeViewport.startFrame === next.timeViewport.startFrame &&
    previous.timeViewport.endFrame === next.timeViewport.endFrame
  )
}

function arePropertyLinkCallbacksEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    previous.onPropertyLinkPointerDown === next.onPropertyLinkPointerDown &&
    previous.onRemovePropertyLink === next.onRemovePropertyLink &&
    previous.onSetPropertyExpression === next.onSetPropertyExpression &&
    previous.onRemovePropertyExpression === next.onRemovePropertyExpression
  )
}

function arePropertyListsEqual(
  previous: AnimatableProperty[],
  next: AnimatableProperty[],
): boolean {
  return (
    previous.length === next.length && previous.every((property, index) => property === next[index])
  )
}

export function areMotionDopesheetLanesPropsEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    areItemsEqualForMotionDopesheet(previous.item, next.item) &&
    arePresentationPropsEqual(previous, next) &&
    areViewportPropsEqual(previous, next) &&
    arePropertyLinkCallbacksEqual(previous, next) &&
    previous.itemById === next.itemById &&
    previous.itemKeyframes === next.itemKeyframes &&
    arePropertyListsEqual(previous.properties, next.properties)
  )
}
