import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSendBack } from './use-send-back'
import { useEmbeddedStore } from '../stores/embedded-store'

const { saveTimeline, exportProjectJson } = vi.hoisted(() => ({
  saveTimeline: vi.fn(async (_projectId: string) => {}),
  exportProjectJson: vi.fn(async () => ({ version: 2, items: [] })),
}))

vi.mock('../deps/projects-contract', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'p1' } }) },
}))
vi.mock('../deps/project-bundle-contract', () => ({ exportProjectJson }))
vi.mock('../deps/timeline-contract', () => ({ saveTimeline }))

describe('useSendBack (save & exit)', () => {
  beforeEach(() => {
    useEmbeddedStore.setState({ parentOrigin: null, sendBackStatus: 'idle' })
    saveTimeline.mockClear()
    exportProjectJson.mockClear()
  })

  it('posts FREECUT_SAVE_EXIT with the project JSON to the parent origin, no render', async () => {
    useEmbeddedStore.getState().setParentOrigin('http://localhost:8123')
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const { result } = renderHook(() => useSendBack())
    await act(() => result.current.saveExit())

    expect(postSpy).toHaveBeenCalledWith(
      {
        type: 'FREECUT_SAVE_EXIT',
        payload: { projectJson: { version: 2, items: [] } },
      },
      'http://localhost:8123',
    )
    expect(useEmbeddedStore.getState().sendBackStatus).toBe('sent')
    // The project handed back carries the latest edits: the timeline is saved first.
    expect(saveTimeline).toHaveBeenCalledWith('p1')
    const [saved] = saveTimeline.mock.invocationCallOrder
    const [read] = exportProjectJson.mock.invocationCallOrder
    expect(saved).toBeLessThan(read!)
    postSpy.mockRestore()
  })

  it('does nothing before the parent handshake set an origin', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const { result } = renderHook(() => useSendBack())
    await act(() => result.current.saveExit())

    expect(postSpy).not.toHaveBeenCalled()
    expect(useEmbeddedStore.getState().sendBackStatus).toBe('idle')
    postSpy.mockRestore()
  })
})
