import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DopesheetEditor } from './index'

describe('DopesheetEditor property-row progressive disclosure', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  beforeEach(() => {
    localStorage.clear()
  })

  function renderEditor(overrides: Partial<ComponentProps<typeof DopesheetEditor>> = {}) {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [], y: [] }}
        propertyValues={{ x: 100, y: 200 }}
        currentFrame={12}
        width={640}
        height={240}
        onPropertyValueCommit={vi.fn()}
        {...overrides}
      />,
    )
  }

  function isInsidePointerEventsNone(element: HTMLElement): boolean {
    let node: HTMLElement | null = element
    while (node) {
      if (node.classList.contains('pointer-events-none')) {
        return true
      }
      node = node.parentElement
    }
    return false
  }

  it('keeps an enabled auto-key button visible at rest (not pointer-events-none)', () => {
    renderEditor()

    const enableButton = screen.getByRole('button', {
      name: /enable auto-key for x position/i,
    })

    fireEvent.click(enableButton)

    const enabledButton = screen.getByRole('button', {
      name: /auto-key enabled for x position/i,
    })
    expect(enabledButton).toHaveAttribute('aria-pressed', 'true')
    // Once active, the cluster stays visible at rest — no pointer-events-none ancestor.
    expect(isInsidePointerEventsNone(enabledButton as HTMLElement)).toBe(false)
  })
})
