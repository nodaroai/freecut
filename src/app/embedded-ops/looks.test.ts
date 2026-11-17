// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import type { GpuEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { embeddedEditOpEngine } from '../embedded-edit-ops'

type Op = Record<string, unknown> & { op: string }
type Applied = { effects: Array<{ itemId: string; effectId: string }> }

async function batch(...ops: Op[]) {
  const prepared: Op[] = []
  for (const op of ops) prepared.push(await embeddedEditOpEngine.prepare(op))
  return useTimelineCommandStore
    .getState()
    .executeBatch({ type: 'APPLY_EDIT_OPS', payload: { count: ops.length } }, () =>
      prepared.map((op) => embeddedEditOpEngine.apply(op)),
    )
}

const piece = (id: string, type: 'video' | 'audio', from: number) =>
  ({
    id,
    type,
    trackId: type === 'video' ? 'v1' : 'a1',
    from,
    durationInFrames: 30,
    label: 'take.mp4',
    src: 'blob:take',
    mediaId: 'take',
  }) as TimelineItem

const effectsOf = (id: string) => useItemsStore.getState().itemById[id]?.effects ?? []

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useItemsStore.getState().setTracks([
    {
      id: 'v1',
      name: 'V1',
      kind: 'video',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items: [],
    },
    {
      id: 'a1',
      name: 'A1',
      kind: 'audio',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [],
    },
  ])
  useItemsStore
    .getState()
    .setItems([piece('v-a', 'video', 0), piece('a-a', 'audio', 0), piece('v-b', 'video', 30)])
  useProjectStore.setState({
    currentProject: {
      id: 'p1',
      name: 'Take',
      metadata: { width: 1920, height: 1080, fps: 30 },
    } as never,
  })
})

describe('applyLook', () => {
  it('adds the look to every picture clip of the media and answers the effect ids', async () => {
    const [result] = (await batch({
      op: 'applyLook',
      mediaId: 'take',
      look: 'warm',
      amount: 0.5,
    })) as [Applied]

    expect(result.effects.map((e) => e.itemId)).toEqual(['v-a', 'v-a', 'v-b', 'v-b'])
    expect(result.effects.map((e) => e.effectId)).toEqual([
      ...effectsOf('v-a').map((e) => e.id),
      ...effectsOf('v-b').map((e) => e.id),
    ])
    const temperature = effectsOf('v-a')[0]!.effect as GpuEffect
    expect(temperature).toMatchObject({
      gpuEffectType: 'gpu-temperature',
      params: { temperature: 0.3 },
    })
    expect(effectsOf('a-a')).toEqual([])
  })

  it('makes black and white with grayscale', async () => {
    await batch({ op: 'applyLook', mediaId: 'take', look: 'bw' })

    expect((effectsOf('v-b')[0]!.effect as GpuEffect).gpuEffectType).toBe('gpu-grayscale')
  })

  it('refuses an unknown look or amount', async () => {
    await expect(batch({ op: 'applyLook', mediaId: 'take', look: 'teal' })).rejects.toThrow(
      "applyLook: `look` must be one of 'warm', 'cool', 'vivid', 'bw'",
    )
    await expect(
      batch({ op: 'applyLook', mediaId: 'take', look: 'cool', amount: 2 }),
    ).rejects.toThrow('applyLook: `amount` must be from 0 to 1')
  })
})

describe('removeEffects', () => {
  it('takes the look off again', async () => {
    const [applied] = (await batch({ op: 'applyLook', mediaId: 'take', look: 'vivid' })) as [
      Applied,
    ]

    await batch({ op: 'removeEffects', effects: applied.effects })

    expect(effectsOf('v-a')).toEqual([])
    expect(effectsOf('v-b')).toEqual([])
  })

  it('refuses an effect the item does not carry', async () => {
    await expect(
      batch({ op: 'removeEffects', effects: [{ itemId: 'v-a', effectId: 'nope' }] }),
    ).rejects.toThrow('removeEffects: effect "nope" is not on item "v-a"')
  })
})

describe('blurItems', () => {
  const blurOf = (id: string) =>
    effectsOf(id)
      .map((e) => e.effect as GpuEffect)
      .filter((e) => e.gpuEffectType === 'gpu-gaussian-blur')

  it('blurs the named clips only and answers the effect ids', async () => {
    const [result] = (await batch({ op: 'blurItems', ids: ['v-a'], radius: 30 })) as [Applied]

    expect(result.effects).toEqual([{ itemId: 'v-a', effectId: effectsOf('v-a')[0]!.id }])
    expect(blurOf('v-a')[0]!.params.radius).toBe(30)
    expect(effectsOf('v-b')).toEqual([])
  })

  it('keeps one blur per clip: a new radius replaces the old one, and a look stays', async () => {
    await batch({ op: 'applyLook', mediaId: 'take', look: 'bw' })
    await batch({ op: 'blurItems', ids: ['v-a'], radius: 30 })
    await batch({ op: 'blurItems', ids: ['v-a'], radius: 12 })

    expect(blurOf('v-a').map((e) => e.params.radius)).toEqual([12])
    expect(effectsOf('v-a')).toHaveLength(3)
  })

  it('takes the blur off with radius 0, and does nothing to a clip that has none', async () => {
    await batch({ op: 'blurItems', ids: ['v-a'], radius: 30 })
    const [result] = (await batch({ op: 'blurItems', ids: ['v-a', 'v-b'], radius: 0 })) as [Applied]

    expect(result.effects).toEqual([])
    expect(effectsOf('v-a')).toEqual([])
  })

  it('refuses a sound clip and a radius out of range', async () => {
    await expect(batch({ op: 'blurItems', ids: ['a-a'], radius: 10 })).rejects.toThrow(
      'blurItems: item a-a is not a picture clip',
    )
    await expect(batch({ op: 'blurItems', ids: ['v-a'], radius: 80 })).rejects.toThrow(
      'blurItems: `radius` must be from 0 to 50',
    )
  })
})
