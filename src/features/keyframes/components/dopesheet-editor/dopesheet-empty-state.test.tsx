import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { DopesheetEmptyState } from './dopesheet-empty-state'

describe('DopesheetEmptyState', () => {
  it('renders guidance with hint texts when showGuidance is true', () => {
    render(<DopesheetEmptyState showGuidance fallbackMessage="No keyframes to display" />)

    expect(screen.getByTestId('dopesheet-empty-state-guidance')).toBeTruthy()
    expect(screen.getByText(/press Enter to set a keyframe/i)).toBeTruthy()
    expect(screen.getByText(/click the diamond/i)).toBeTruthy()
    expect(screen.getByText(/auto-key/i)).toBeTruthy()
  })

  it('renders only the fallback message when showGuidance is false', () => {
    render(<DopesheetEmptyState showGuidance={false} fallbackMessage="No parameters match" />)

    expect(screen.queryByTestId('dopesheet-empty-state-guidance')).toBeNull()
    expect(screen.getByText('No parameters match')).toBeTruthy()
  })
})
