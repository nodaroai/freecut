import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuWheelsPanel } from './gpu-wheels-panel'

const definition = getGpuEffect('gpu-color-wheels')!

function makeProps(params: Record<string, number | boolean | string> = {}) {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: 'gpu-color-wheels',
    params: { ...getGpuEffectDefaultParams('gpu-color-wheels'), ...params },
  }
  const effect: ItemEffect = { id: 'fx-wheels', effect: gpuEffect, enabled: true }
  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onParamsBatchChange: vi.fn(),
    onParamsBatchLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuWheelsPanel', () => {
  it('renders a Resolve-style four-wheel primaries dock', () => {
    render(<GpuWheelsPanel {...makeProps()} layout="dock" />)

    expect(screen.getByText('Primaries - Color Wheels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Lift wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Gamma wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Gain wheel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adjust Offset wheel' })).toBeInTheDocument()

    for (const label of [
      'Temperature',
      'Tint',
      'Contrast',
      'Pivot',
      'Mid/Detail',
      'Color Boost',
      'Shadows',
      'Highlights',
      'Saturation',
      'Hue',
      'Lum Mix',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('commits numeric wheel value edits from the dock strip', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    fireEvent.change(screen.getByLabelText('Lift'), { target: { value: '0.05' } })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
  })
})
