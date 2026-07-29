import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolbarDocsLink } from './toolbar-docs-link'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ToolbarDocsLink', () => {
  it('links to the built-in docs in a new tab', () => {
    render(<ToolbarDocsLink />)

    const link = screen.getByRole('link', { name: 'toolbar.userGuide' })
    expect(link).toHaveAttribute('href', '/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
