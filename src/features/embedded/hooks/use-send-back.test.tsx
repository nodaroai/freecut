import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSendBack } from './use-send-back'
import { useEmbeddedStore } from '../stores/embedded-store'

vi.mock('../deps/projects-contract', () => ({
  useProjectStore: { getState: () => ({ currentProject: { id: 'p1' } }) },
}))
vi.mock('../deps/project-bundle-contract', () => ({
  exportProjectJson: vi.fn(async () => ({ version: 2, items: [] })),
}))
vi.mock('../deps/timeline-contract', () => ({
  useTimelineStore: { getState: () => ({ saveTimeline: vi.fn(async () => {}) }) },
}))

describe('useSendBack (save & exit)', () => {
  beforeEach(() => {
    useEmbeddedStore.setState({ parentOrigin: null, sendBackStatus: 'idle' })
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
