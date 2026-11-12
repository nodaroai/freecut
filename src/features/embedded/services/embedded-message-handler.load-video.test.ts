import { describe, expect, it, vi } from 'vitest'

// NODARO_LOAD_VIDEO ends by opening the new project in the editor. A feature
// never imports the app's router, so the app shell passes in how to open it
// (initEmbeddedMessageHandler's openEditor). The empty boot is the shortest
// path there: no primary video to fetch or probe.
const mocks = vi.hoisted(() => ({
  createProject: vi.fn(async () => ({ id: 'project-1' })),
}))

vi.mock('../deps/projects-contract', () => ({
  useProjectStore: { getState: () => ({ createProject: mocks.createProject }) },
}))
vi.mock('../deps/media-library-contract', () => ({
  mediaLibraryService: { importMediaBlob: vi.fn() },
  mediaProcessorService: {},
}))
vi.mock('./embedded-workspace', () => ({ ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}) }))
vi.mock('./timeline-add', () => ({ addMediaToTimelineAtPlayhead: vi.fn() }))
vi.mock('@/infrastructure/storage', () => ({ updateProject: vi.fn(), getProject: vi.fn() }))

import { initEmbeddedMessageHandler } from './embedded-message-handler'

describe('NODARO_LOAD_VIDEO opens the editor through the app shell', () => {
  it('an empty boot opens the new project with the openEditor the app passed in', async () => {
    const openEditor = vi.fn()
    initEmbeddedMessageHandler({ openEditor })

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://app.nodaro.ai',
        data: { type: 'NODARO_LOAD_VIDEO', payload: {} },
      }),
    )

    await vi.waitFor(() => expect(openEditor).toHaveBeenCalledWith('project-1'))
    expect(mocks.createProject).toHaveBeenCalledOnce()
  })
})
