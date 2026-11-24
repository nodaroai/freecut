import { beforeAll, describe, expect, it, vi } from 'vitest'

// NODARO_IMPORT_FILES imports into the open project; these stand-ins give it
// one and hand each imported file its own media id.
vi.mock('./embedded-workspace', () => ({ ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}) }))
vi.mock('../deps/projects-contract', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: { id: 'p1' }, createProject: async () => ({ id: 'p2' }) }),
    subscribe: () => () => {},
  },
}))
vi.mock('../deps/media-library-contract', async () => {
  const { create } = await import('zustand')
  let next = 0
  return {
    mediaLibraryService: {
      importMediaBlob: vi.fn(async () => {
        next += 1
        return { id: `media-${next}` }
      }),
    },
    mediaProcessorService: {},
    useMediaLibraryStore: create(() => ({
      currentProjectId: null,
      isLoading: false,
      mediaItems: [],
      loadMediaItems: async () => {},
    })),
  }
})

import { initEmbeddedMessageHandler } from './embedded-message-handler'
import { refsByMediaId } from './imported-refs'

const send = (type: string, payload: Record<string, unknown>) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'http://localhost:5173',
      source: window,
      data: { type, payload },
    }),
  )

beforeAll(() => {
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  initEmbeddedMessageHandler({ openEditor: vi.fn(), saveLocation: () => () => {} })
})

describe('NODARO_IMPORT_FILES', () => {
  it('two files carrying the same ref in one message both map to it', async () => {
    const file = (name: string) => ({
      name,
      type: 'video/mp4',
      buffer: new ArrayBuffer(1),
      ref: 'r1',
    })

    send('NODARO_IMPORT_FILES', { files: [file('a.mp4'), file('b.mp4')] })

    await vi.waitFor(() => expect(refsByMediaId()).toEqual({ 'media-1': 'r1', 'media-2': 'r1' }))
  })
})
