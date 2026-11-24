import { beforeAll, describe, expect, it, vi } from 'vitest'

// NODARO_IMPORT_FILES imports into the open project; these stand-ins give it
// one and hand each imported file its own media id.
vi.mock('./embedded-workspace', () => ({ ensureEmbeddedWorkspaceMounted: vi.fn(async () => {}) }))
vi.mock('../deps/projects-contract', () => ({
  useProjectStore: {
    getState: () => ({ currentProject: { id: 'p1' }, createProject: async () => ({ id: 'p2' }) }),
  },
}))
vi.mock('../deps/media-library-contract', () => {
  let next = 0
  return {
    mediaLibraryService: {
      importMediaBlob: vi.fn(async () => {
        next += 1
        return { id: `media-${next}` }
      }),
    },
    mediaProcessorService: {},
    useMediaLibraryStore: { getState: () => ({ loadMediaItems: async () => {} }) },
  }
})

import { initEmbeddedMessageHandler } from './embedded-message-handler'
import { claimImportedRef, refsByMediaId } from './imported-refs'

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
  initEmbeddedMessageHandler({ openEditor: vi.fn() })
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

describe('the refs name only the open project', () => {
  it('NODARO_RESET_PROJECT clears them', () => {
    claimImportedRef('r-old')('m-old')

    send('NODARO_RESET_PROJECT', {})

    expect(refsByMediaId()).toEqual({})
  })

  it('NODARO_LOAD_VIDEO clears them as it makes a fresh project', () => {
    claimImportedRef('r-old')('m-old')

    send('NODARO_LOAD_VIDEO', {})

    expect(refsByMediaId()).toEqual({})
  })
})
