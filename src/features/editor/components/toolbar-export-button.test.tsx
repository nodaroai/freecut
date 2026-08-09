import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ToolbarExportButton } from './toolbar-export-button'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ToolbarExportButton', () => {
  it('opens the export flow when clicked', () => {
    const onExport = vi.fn()
    render(<ToolbarExportButton onExport={onExport} />)

    fireEvent.click(screen.getByRole('button', { name: 'toolbar.export' }))

    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('renders nothing without an export handler', () => {
    render(<ToolbarExportButton />)

    expect(screen.queryByRole('button')).toBeNull()
  })
})
