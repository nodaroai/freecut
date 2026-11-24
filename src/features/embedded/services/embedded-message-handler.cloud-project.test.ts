import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Starting the handler mounts storage, which the test environment does not have.
vi.mock('./embedded-workspace', () => ({
  ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}),
}))
const cloud = vi.hoisted(() => ({
  handleGetProject: vi.fn(async () => {}),
  startProjectChangeAnnouncements: vi.fn(() => () => {}),
}))
vi.mock('./cloud-project', () => cloud)
const opening = vi.hoisted(() => ({
  handleOpenProject: vi.fn(async () => {}),
  setOpenProjectEditor: vi.fn(),
}))
vi.mock('./cloud-project-open', () => opening)

import { initEmbeddedMessageHandler } from './embedded-message-handler'

const ORIGIN = 'http://localhost:5173'
let post: { mock: { calls: unknown[][] }; mockRestore: () => void }

beforeEach(() => {
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  cloud.handleGetProject.mockClear()
  cloud.startProjectChangeAnnouncements.mockClear()
  opening.handleOpenProject.mockClear()
})
afterEach(() => post.mockRestore())

describe('cloud-project wiring', () => {
  it('announces the capability and starts the change announcements with the handler', () => {
    initEmbeddedMessageHandler({ openEditor: vi.fn() })

    const ready = post.mock.calls
      .map((call) => call[0] as { type?: string; capabilities?: string[] })
      .find((message) => message.type === 'FREECUT_READY')
    expect(ready?.capabilities).toContain('cloud-project')
    expect(cloud.startProjectChangeAnnouncements).toHaveBeenCalledTimes(1)
  })

  it('routes NODARO_GET_PROJECT from the parent, behind the origin check', () => {
    initEmbeddedMessageHandler({ openEditor: vi.fn() })
    const send = (origin: string) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'NODARO_GET_PROJECT', payload: { requestId: 'g1' } },
          origin,
          source: window,
        }),
      )

    send('https://evil.example.com')
    expect(cloud.handleGetProject).not.toHaveBeenCalled()

    send(ORIGIN)
    expect(cloud.handleGetProject).toHaveBeenCalled()
    const [event] = cloud.handleGetProject.mock.calls[0] as unknown as [MessageEvent]
    expect(event.data.payload).toEqual({ requestId: 'g1' })
  })

  it('routes NODARO_OPEN_PROJECT from the parent, behind the origin check', () => {
    const openEditor = vi.fn()
    initEmbeddedMessageHandler({ openEditor })
    expect(opening.setOpenProjectEditor).toHaveBeenCalledWith(openEditor)
    const send = (origin: string) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'NODARO_OPEN_PROJECT', payload: { requestId: 'o1' } },
          origin,
          source: window,
        }),
      )

    send('https://evil.example.com')
    expect(opening.handleOpenProject).not.toHaveBeenCalled()

    send(ORIGIN)
    expect(opening.handleOpenProject).toHaveBeenCalledTimes(1)
    const [event] = opening.handleOpenProject.mock.calls[0] as unknown as [MessageEvent]
    expect(event.origin).toBe(ORIGIN)
  })
})
