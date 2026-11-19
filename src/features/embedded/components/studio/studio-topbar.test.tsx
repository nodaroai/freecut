import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudioStore } from '../../stores/studio-store'
import { StudioCrewBar } from './studio-topbar'

describe('StudioCrewBar host buttons', () => {
  const parent = { postMessage: vi.fn() }
  let parentSpy: { mockRestore: () => void } | undefined

  beforeEach(() => {
    parent.postMessage.mockClear()
    parentSpy = vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
    useStudioStore.setState({
      on: true,
      sideOpen: false,
      sideLabel: 'Edit with AI',
      origin: 'https://parent.test',
      hostButtons: [
        { id: 'soundtrack', label: 'Soundtrack' },
        { id: 'notes', label: 'Notes' },
      ],
    })
  })
  afterEach(() => {
    parentSpy?.mockRestore()
    useStudioStore.setState({ hostButtons: [], origin: null, on: false, sideLabel: '' })
  })

  it('draws the host buttons in order, before the side-panel toggle', () => {
    const { container } = render(<StudioCrewBar />)
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels.slice(0, 3)).toEqual(['Soundtrack', 'Notes', 'Edit with AI'])
  })

  it('tells the parent which host button was pressed', () => {
    render(<StudioCrewBar />)
    fireEvent.click(screen.getByTitle('Notes'))
    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: 'FREECUT_STUDIO_ACTION',
        payload: expect.objectContaining({ action: 'host-button', id: 'notes' }),
      },
      'https://parent.test',
    )
  })
})
