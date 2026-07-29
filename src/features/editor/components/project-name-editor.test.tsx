import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProjectNameEditor } from './project-name-editor'

const { updateProjectMock, storeState } = vi.hoisted(() => {
  const updateProjectMock = vi.fn(async () => ({}))
  const storeState: {
    currentProject: { id: string; name: string } | null
    updateProject: typeof updateProjectMock
  } = {
    currentProject: null,
    updateProject: updateProjectMock,
  }
  return { updateProjectMock, storeState }
})

vi.mock('../deps/projects', () => {
  const useProjectStore = (selector: (s: typeof storeState) => unknown) => selector(storeState)
  useProjectStore.getState = () => storeState
  return { useProjectStore }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ProjectNameEditor', () => {
  beforeEach(() => {
    updateProjectMock.mockClear()
    storeState.currentProject = null
  })

  it('shows the project name and enters edit mode on double click', () => {
    render(<ProjectNameEditor project={{ id: 'p1', name: 'TEST2' }} />)

    fireEvent.doubleClick(screen.getByText('TEST2'))

    expect(screen.getByRole('textbox')).toHaveValue('TEST2')
  })

  it('commits a new name on Enter through the project store', () => {
    render(<ProjectNameEditor project={{ id: 'p1', name: 'TEST2' }} />)

    fireEvent.doubleClick(screen.getByText('TEST2'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'My Movie' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateProjectMock).toHaveBeenCalledWith('p1', { name: 'My Movie' })
  })

  it('cancels on Escape without renaming', () => {
    render(<ProjectNameEditor project={{ id: 'p1', name: 'TEST2' }} />)

    fireEvent.doubleClick(screen.getByText('TEST2'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Ignored' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(updateProjectMock).not.toHaveBeenCalled()
    expect(screen.getByText('TEST2')).toBeInTheDocument()
  })

  it('does not rename when the trimmed name is empty or unchanged', () => {
    render(<ProjectNameEditor project={{ id: 'p1', name: 'TEST2' }} />)

    fireEvent.doubleClick(screen.getByText('TEST2'))
    let input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateProjectMock).not.toHaveBeenCalled()

    fireEvent.doubleClick(screen.getByText('TEST2'))
    input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateProjectMock).not.toHaveBeenCalled()
  })

  it('prefers the live store name once the project is renamed elsewhere', () => {
    storeState.currentProject = { id: 'p1', name: 'Renamed Live' }

    render(<ProjectNameEditor project={{ id: 'p1', name: 'TEST2' }} />)

    expect(screen.getByText('Renamed Live')).toBeInTheDocument()
  })
})
