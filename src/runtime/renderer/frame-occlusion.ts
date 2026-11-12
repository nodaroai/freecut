import type { TimelineItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ItemEffect } from '@/types/effects'
import type { ResolvedTransform } from '@/types/transform'
import { hasMediaCrop } from '@/shared/utils/media-crop'
import { getAnimatedCrop, getAnimatedTransform } from './canvas-keyframes'
import { resolveAnimatedColorEffects } from '@/runtime/renderer/deps/keyframes-contract'
import { getAdjustmentLayerEffects, type AdjustmentLayerWithTrackOrder } from './canvas-effects'
import type { CanvasSettings } from './canvas-item-renderer'

export interface FrameOcclusionContext {
  frame: number
  canvasWidth: number
  canvasHeight: number
  canvasSettings: CanvasSettings
  renderMode: 'export' | 'preview'
  /** Clip ids participating in a transition this frame (blended, never fully occluding). */
  transitionClipIds: ReadonlySet<string>
  adjustmentLayers: AdjustmentLayerWithTrackOrder[]
  getCurrentItem: <TItem extends TimelineItem>(item: TItem) => TItem
  getCurrentKeyframes: (itemId: string) => ItemKeyframes | undefined
  /**
   * True when a video item's decoded source may carry an alpha channel, so it is
   * NOT opaque and must never occlude the layers beneath it. Optional: when
   * absent (e.g. before media init), items are treated as opaque as before.
   */
  hasTransparentVideoSource?: (item: TimelineItem) => boolean
  getPreviewEffectsOverride?: (itemId: string) => ItemEffect[] | undefined
  getLiveItemSnapshot?: (itemId: string) => TimelineItem | undefined
}

/**
 * Whether `baseItem` fully and opaquely covers the canvas this frame, so every
 * track below it (higher order) can be skipped during occlusion culling.
 *
 * An item fully occludes only when it is opaque video/image content that covers
 * the whole canvas after transform/keyframes with: opacity 1, rotation 0/180,
 * no corner radius, no crop, no corner pin, normal blend mode, not in a
 * transition, and no transparency-adding effects (item or adjustment-layer).
 *
 * Pure predicate extracted verbatim from `createCompositionRenderer`'s
 * per-frame render path — no side effects.
 */
function canMediaItemOcclude(item: TimelineItem, ctx: FrameOcclusionContext): boolean {
  if (item.type !== 'video' && item.type !== 'image') return false
  if (item.type === 'video' && ctx.hasTransparentVideoSource?.(item)) return false
  if (ctx.transitionClipIds.has(item.id)) return false
  if (item.blendMode && item.blendMode !== 'normal') return false
  return !item.cornerPin
}

function hasOpaqueCanvasCoverage(
  transform: ResolvedTransform,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  if (transform.opacity < 1) return false
  const rotation = transform.rotation % 360
  if (rotation !== 0 && rotation !== 180 && rotation !== -180) return false
  if (transform.cornerRadius > 0) return false

  const itemLeft = canvasWidth / 2 + transform.x - transform.width / 2
  const itemTop = canvasHeight / 2 + transform.y - transform.height / 2
  const itemRight = itemLeft + transform.width
  const itemBottom = itemTop + transform.height
  const tolerance = 1
  if (itemLeft > tolerance || itemTop > tolerance) return false
  return itemRight >= canvasWidth - tolerance && itemBottom >= canvasHeight - tolerance
}

function hasTransparencyAddingEffect(effects: ItemEffect[]): boolean {
  for (const effectWrapper of effects) {
    if (!effectWrapper.enabled) continue
    const effect = effectWrapper.effect
    if ('opacity' in effect && typeof effect.opacity === 'number' && effect.opacity < 1) {
      return true
    }
  }
  return false
}

export function isItemFullyOccluding(
  baseItem: TimelineItem,
  trackOrder: number,
  ctx: FrameOcclusionContext,
): boolean {
  const item = ctx.getCurrentItem(baseItem)
  if (!canMediaItemOcclude(item, ctx)) return false

  const itemKeyframes = ctx.getCurrentKeyframes(item.id)
  const animatedCrop = getAnimatedCrop(item, itemKeyframes, ctx.frame, ctx.canvasSettings)
  if (hasMediaCrop(animatedCrop)) return false
  const transform = getAnimatedTransform(item, itemKeyframes, ctx.frame, ctx.canvasSettings)
  if (!hasOpaqueCanvasCoverage(transform, ctx.canvasWidth, ctx.canvasHeight)) return false

  const itemEffects =
    resolveAnimatedColorEffects(
      item.effects ?? [],
      ctx.getCurrentKeyframes(item.id),
      ctx.frame - item.from,
    ) ?? []
  const adjustmentEffects = getAdjustmentLayerEffects(
    trackOrder,
    ctx.adjustmentLayers,
    ctx.frame,
    ctx.renderMode === 'preview' ? ctx.getPreviewEffectsOverride : undefined,
    ctx.renderMode === 'preview' ? ctx.getLiveItemSnapshot : undefined,
    ctx.getCurrentKeyframes,
  )
  return !hasTransparencyAddingEffect([...itemEffects, ...adjustmentEffects])
}
