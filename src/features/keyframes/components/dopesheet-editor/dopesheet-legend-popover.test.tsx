import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { DopesheetLegendPopover } from './dopesheet-legend-popover'

describe('DopesheetLegendPopover', () => {
  it('renders the trigger with its accessible name', () => {
    render(<DopesheetLegendPopover />)

    expect(screen.getByRole('button', { name: /what do these icons mean/i })).toBeTruthy()
  })

  it('shows the mode and icon guide after the trigger is clicked', async () => {
    render(<DopesheetLegendPopover />)

    fireEvent.click(screen.getByRole('button', { name: /what do these icons mean/i }))

    expect(await screen.findByText(/edit each parameter's value curve/i)).toBeTruthy()
    expect(await screen.findByText(/capture a keyframe automatically/i)).toBeTruthy()
  })
})
