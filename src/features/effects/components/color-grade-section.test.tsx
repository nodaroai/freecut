import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ItemEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { ColorGradeSection } from './color-grade-section'

const mocks = vi.hoisted(() => {
  const timelineState = {
    addEffects: vi.fn(),
    setItemEffects: vi.fn(),
    updateEffect: vi.fn(),
    removeEffect: vi.fn(),
    toggleEffect: vi.fn(),
    applyAutoKeyframeOperations: vi.fn(),
  }
  const gizmoState = {
    setEffectsPreviewNew: vi.fn(),
    clearPreview: vi.fn(),
    colorGradeComparisonMode: 'off' as const,
    setColorGradeComparisonMode: vi.fn(),
  }
  const presetsState = {
    presets: [],
    loadPresets: vi.fn(() => Promise.resolve()),
    addPreset: vi.fn(() => Promise.resolve(null)),
    removePreset: vi.fn(() => Promise.resolve()),
  }
  return { timelineState, gizmoState, presetsState }
})

vi.mock('@/features/effects/deps/timeline-contract', () => ({
  useTimelineStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
}))

vi.mock('@/features/effects/deps/preview-contract', () => ({
  useGizmoStore: (selector: (state: typeof mocks.gizmoState) => unknown) =>
    selector(mocks.gizmoState),
  useThrottledFrame: () => 12,
}))

vi.mock('../hooks/use-keyframes-by-item-id', () => ({
  useKeyframesByItemId: () => new Map(),
}))

vi.mock('../stores/user-presets-store', () => {
  const useUserPresetsStore = (selector: (state: typeof mocks.presetsState) => unknown) =>
    selector(mocks.presetsState)
  useUserPresetsStore.getState = () => mocks.presetsState
  return { useUserPresetsStore }
})

vi.mock('./panels', () => ({
  GpuWheelsPanel: ({
    effect,
    onParamsBatchChange,
    onParamsBatchLiveChange,
  }: {
    effect: ItemEffect
    onParamsBatchChange: (effectId: string, updates: Record<string, number>) => void
    onParamsBatchLiveChange: (effectId: string, updates: Record<string, number>) => void
  }) => (
    <div data-testid="wheels-panel" data-effect-id={effect.id}>
      <button type="button" onClick={() => onParamsBatchLiveChange(effect.id, { lift: 0.1 })}>
        live wheels
      </button>
      <button type="button" onClick={() => onParamsBatchChange(effect.id, { lift: 0.1 })}>
        commit wheels
      </button>
    </div>
  ),
  GpuCurvesPanel: ({
    effect,
    onParamsBatchChange,
  }: {
    effect: ItemEffect
    onParamsBatchChange: (effectId: string, updates: Record<string, string>) => void
  }) => (
    <div data-testid="curves-panel" data-effect-id={effect.id}>
      <button type="button" onClick={() => onParamsBatchChange(effect.id, { masterPoints: '[[0,0],[1,1]]' })}>
        commit curves
      </button>
    </div>
  ),
}))

function makeVideoItem(effects: ItemEffect[] = []): TimelineItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: 'clip.mp4',
    src: 'blob:clip',
    mediaId: 'media-1',
    effects,
  }
}

describe('ColorGradeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gizmoState.colorGradeComparisonMode = 'off'
  })

  it('previews and creates a single color wheels effect on first adjustment', () => {
    render(<ColorGradeSection items={[makeVideoItem()]} />)

    fireEvent.click(screen.getByText('live wheels'))
    expect(mocks.gizmoState.setEffectsPreviewNew).toHaveBeenCalledWith({
      'clip-1': [
        expect.objectContaining({
          id: '__grade:gpu-color-wheels__',
          effect: expect.objectContaining({
            gpuEffectType: 'gpu-color-wheels',
            params: expect.objectContaining({ lift: 0.1 }),
          }),
        }),
      ],
    })
    expect(mocks.timelineState.addEffects).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('commit wheels'))
    expect(mocks.timelineState.addEffects).toHaveBeenCalledTimes(1)
    expect(mocks.timelineState.addEffects).toHaveBeenCalledWith([
      {
        itemId: 'clip-1',
        effects: [
          expect.objectContaining({
            gpuEffectType: 'gpu-color-wheels',
            params: expect.objectContaining({ lift: 0.1 }),
          }),
        ],
      },
    ])
  })

  it('updates an existing curves effect instead of adding a duplicate', () => {
    const curves: ItemEffect = {
      id: 'curves-1',
      enabled: true,
      effect: {
        type: 'gpu-effect',
        gpuEffectType: 'gpu-curves',
        params: { masterPoints: '[[0,0],[1,1]]' },
      },
    }
    render(<ColorGradeSection items={[makeVideoItem([curves])]} />)

    expect(screen.getByTestId('curves-panel')).toHaveAttribute('data-effect-id', 'curves-1')
    fireEvent.click(screen.getByText('commit curves'))

    expect(mocks.timelineState.updateEffect).toHaveBeenCalledWith('clip-1', 'curves-1', {
      effect: {
        ...curves.effect,
        params: { masterPoints: '[[0,0],[1,1]]' },
      },
    })
    expect(mocks.timelineState.addEffects).not.toHaveBeenCalled()
  })
})
