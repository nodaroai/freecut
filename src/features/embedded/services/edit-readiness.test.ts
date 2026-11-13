import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  project: { id: 'p1' } as unknown,
  loading: false,
}))
vi.mock('../deps/projects-contract', () => ({
  useProjectStore: { getState: () => ({ currentProject: state.project }) },
}))
vi.mock('../deps/timeline-contract', () => ({
  useTimelineSettingsStore: { getState: () => ({ isTimelineLoading: state.loading }) },
}))

import { editBlocker, waitUntilEditable } from './edit-readiness'
import { useEmbeddedStore } from '../stores/embedded-store'

beforeEach(() => {
  state.project = { id: 'p1' }
  state.loading = false
  useEmbeddedStore.setState({ isImporting: false, pendingVideoImport: null })
})
afterEach(() => vi.useRealTimers())

describe('edit readiness', () => {
  it('answers the open project when nothing is in the way', async () => {
    expect(editBlocker()).toBeNull()
    await expect(waitUntilEditable()).resolves.toBe('p1')
  })

  it('refuses at once when no project is open', async () => {
    state.project = null
    await expect(waitUntilEditable(60_000)).rejects.toThrow('No project is open')
  })

  it('waits for the timeline to load, then answers', async () => {
    state.loading = true
    const ready = waitUntilEditable()
    setTimeout(() => {
      state.loading = false
    }, 250)
    await expect(ready).resolves.toBe('p1')
  })

  it('waits for a running import and for the queued primary video', () => {
    useEmbeddedStore.setState({ isImporting: true })
    expect(editBlocker()).toBe('The video is still being imported')
    useEmbeddedStore.setState({ isImporting: false, pendingVideoImport: { mediaId: 'm1' } })
    expect(editBlocker()).toBe('The video is still being imported')
  })

  it('waits while a pointer is held down, and refuses with the reason after the wait', async () => {
    await waitUntilEditable() // starts watching pointers
    document.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7 }))
    expect(editBlocker()).toBe('The person is dragging on the timeline')
    await expect(waitUntilEditable(300)).rejects.toThrow('The person is dragging on the timeline')
    document.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    expect(editBlocker()).toBeNull()
  })
})
