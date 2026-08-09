import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendExportToStudio } from './studio-export-bridge'
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

/** jsdom's Blob lacks arrayBuffer(); a minimal stand-in carries the bytes. */
function blobOf(bytes: number[]): Blob {
  return {
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Blob
}

describe('sendExportToStudio', () => {
  beforeEach(() => {
    useEmbeddedStore.setState({ isEmbedded: false, parentOrigin: null })
  })

  it('posts FREECUT_EXPORT_COMPLETE with keepOpen so the studio saves without closing', async () => {
    useEmbeddedStore.setState({ isEmbedded: true, parentOrigin: 'http://localhost:8123' })
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const sent = await sendExportToStudio(blobOf([1, 2, 3]))

    expect(sent).toBe(true)
    expect(postSpy).toHaveBeenCalledOnce()
    const [message, origin, transfer] = postSpy.mock.calls[0] as unknown as [
      {
        type: string
        payload: { videoBuffer: ArrayBuffer; projectJson: unknown; keepOpen: boolean }
      },
      string,
      Transferable[],
    ]
    expect(message.type).toBe('FREECUT_EXPORT_COMPLETE')
    expect(message.payload.keepOpen).toBe(true)
    expect(new Uint8Array(message.payload.videoBuffer)).toEqual(new Uint8Array([1, 2, 3]))
    expect(message.payload.projectJson).toEqual({ version: 2, items: [] })
    expect(origin).toBe('http://localhost:8123')
    expect(transfer).toEqual([message.payload.videoBuffer])
    postSpy.mockRestore()
  })

  it('is a no-op outside embedded mode', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const sent = await sendExportToStudio(blobOf([1]))

    expect(sent).toBe(false)
    expect(postSpy).not.toHaveBeenCalled()
    postSpy.mockRestore()
  })
})
