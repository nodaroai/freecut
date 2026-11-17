/**
 * Color looks built from the editor's GPU effects.
 * - `applyLook { mediaId, look: 'warm' | 'cool' | 'vivid' | 'bw', amount?: 0..1 }`
 *   adds the look's effects to every picture clip of the media file and
 *   answers `{ effects: [{ itemId, effectId }] }`.
 * - `blurItems { ids, radius }` blurs the named picture clips (a soft backdrop
 *   behind a sharper copy of the same picture); `radius: 0` takes the blur off.
 *   A clip carries one such blur: a new radius replaces the old one.
 * - `removeEffects { effects: [{ itemId, effectId }] }` takes such effects off again.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addEffect, removeEffect } from '@/features/timeline/stores/timeline-actions'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffect } from '@/types/effects'
import {
  fail,
  optionalChoice,
  optionalNumber,
  requireNumber,
  requireObjects,
  requireString,
} from './op-fields'
import { requireTimelineItem } from './timeline-context'

const LOOKS = ['warm', 'cool', 'vivid', 'bw'] as const
type Look = (typeof LOOKS)[number]

const gpu = (gpuEffectType: string, params: GpuEffect['params']): GpuEffect => ({
  type: 'gpu-effect',
  gpuEffectType,
  params,
})

/** Each look at full strength is `amount: 1`; a smaller amount scales every change toward neutral. */
function lookEffects(look: Look, amount: number): GpuEffect[] {
  switch (look) {
    case 'warm':
      return [
        gpu('gpu-temperature', { temperature: 0.6 * amount, tint: 0.05 * amount }),
        gpu('gpu-vibrance', { amount: 0.15 * amount }),
      ]
    case 'cool':
      return [
        gpu('gpu-temperature', { temperature: -0.6 * amount, tint: 0 }),
        gpu('gpu-saturation', { amount: 1 - 0.08 * amount }),
      ]
    case 'vivid':
      return [
        gpu('gpu-vibrance', { amount: 0.45 * amount }),
        gpu('gpu-saturation', { amount: 1 + 0.15 * amount }),
      ]
    case 'bw':
      return [gpu('gpu-grayscale', { amount }), gpu('gpu-contrast', { amount: 1 + 0.1 * amount })]
  }
}

function readAmount(op: EditOp): number {
  const amount = optionalNumber(op, 'amount') ?? 1
  if (amount < 0 || amount > 1) fail(op, '`amount` must be from 0 to 1')
  return amount
}

export function applyApplyLook(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const look = optionalChoice(op, 'look', LOOKS)
  if (!look) throw new Error(`${op.op} requires \`look\`, one of ${LOOKS.join(', ')}`)
  const effects = lookEffects(look, readAmount(op))
  for (const effect of effects) {
    if (!getGpuEffect(effect.gpuEffectType)) fail(op, `this editor has no ${effect.gpuEffectType}`)
  }
  const clips = useItemsStore
    .getState()
    .items.filter(
      (item) => (item.type === 'video' || item.type === 'image') && item.mediaId === mediaId,
    )
  if (clips.length === 0) throw new Error(`No video clip of media ${mediaId} is on the timeline`)

  const added = clips.flatMap((clip) =>
    effects.map((effect) => {
      addEffect(clip.id, effect)
      // The store appends: the newest effect on the clip is the one just added.
      const effectId = useItemsStore.getState().itemById[clip.id]?.effects?.at(-1)?.id
      if (!effectId) throw new Error(`${op.op}: the effect was not added to ${clip.id}`)
      return { itemId: clip.id, effectId }
    }),
  )
  return { effects: added }
}

export function applyRemoveEffects(op: EditOp): unknown {
  const entries = requireObjects(op, 'effects', '{ itemId, effectId }').map((entry, index) => {
    const { itemId, effectId } = entry
    if (typeof itemId !== 'string' || typeof effectId !== 'string') {
      fail(op, `effects[${index}] needs an itemId and an effectId`)
    }
    const item = requireTimelineItem(op.op, itemId)
    if (!item.effects?.some((effect) => effect.id === effectId)) {
      fail(op, `effect "${effectId}" is not on item "${itemId}"`)
    }
    return { itemId, effectId }
  })
  for (const { itemId, effectId } of entries) removeEffect(itemId, effectId)
  return { removed: entries }
}

const BLUR = 'gpu-gaussian-blur'
const MAX_BLUR_RADIUS = 50

export function applyBlurItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) fail(op, 'needs a non-empty `ids` list')
  const radius = requireNumber(op, 'radius')
  if (radius < 0 || radius > MAX_BLUR_RADIUS) {
    fail(op, `\`radius\` must be from 0 to ${MAX_BLUR_RADIUS}`)
  }
  if (!getGpuEffect(BLUR)) fail(op, `this editor has no ${BLUR}`)
  const clips = ids.map((id) => {
    const item = requireTimelineItem(op.op, id)
    if (item.type !== 'video' && item.type !== 'image') fail(op, `item ${id} is not a picture clip`)
    return item
  })

  const added: Array<{ itemId: string; effectId: string }> = []
  for (const clip of clips) {
    for (const effect of clip.effects ?? []) {
      if (effect.effect.gpuEffectType === BLUR) removeEffect(clip.id, effect.id)
    }
    if (radius === 0) continue
    addEffect(clip.id, gpu(BLUR, { radius, samples: 12 }))
    const effectId = useItemsStore.getState().itemById[clip.id]?.effects?.at(-1)?.id
    if (!effectId) throw new Error(`${op.op}: the effect was not added to ${clip.id}`)
    added.push({ itemId: clip.id, effectId })
  }
  return { effects: added }
}
