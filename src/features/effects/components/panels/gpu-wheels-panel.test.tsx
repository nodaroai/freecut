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

  it('previews numeric wheel value edits live and commits once on blur', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    const input = screen.getByLabelText('Lift')
    fireEvent.change(input, { target: { value: '0.03' } })
    fireEvent.change(input, { target: { value: '0.05' } })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.03)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
  })

  it('scrubs the numeric field horizontally and commits once on release', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    // lift: step 0.005, one step per dragged pixel
    const input = screen.getByLabelText('Lift')
    fireEvent.pointerDown(input, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(input, { clientX: 110, pointerId: 1 })
    fireEvent.pointerMove(input, { clientX: 120, pointerId: 1 })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.1)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(input, { clientX: 120, pointerId: 1 })

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.1)
  })

  it('scrubs wheel level values live and commits once on release', () => {
    const props = makeProps({ lift: 0 })
    render(<GpuWheelsPanel {...props} layout="dock" />)

    const thumb = screen.getByLabelText('Lift thumb wheel')
    fireEvent.change(thumb, { target: { value: '0.05' } })
    fireEvent.change(thumb, { target: { value: '0.07' } })

    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.05)
    expect(props.onParamLiveChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.07)
    expect(props.onParamChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(thumb)

    expect(props.onParamChange).toHaveBeenCalledTimes(1)
    expect(props.onParamChange).toHaveBeenCalledWith('fx-wheels', 'lift', 0.07)
  })
})
