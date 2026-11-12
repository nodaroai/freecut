import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { StrictMode } from 'react'
import { renderHook, render, act, waitFor } from '@testing-library/react'
import { useSendBack } from './use-send-back'
import { useEmbeddedStore } from '../stores/embedded-store'
import { exportProjectJson } from '../deps/project-bundle-contract'

const { saveTimeline } = vi.hoisted(() => ({
  saveTimeline: vi.fn(async (_projectId: string) => {}),
}))

vi.mock('../deps/projects-contract', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject: { id: 'p1', metadata: { width: 720, height: 1280, fps: 25 } },
    }),
  },
}))
vi.mock('../deps/project-bundle-contract', () => ({
  exportProjectJson: vi.fn(async () => ({ version: 2, items: [] })),
}))
vi.mock('../deps/timeline-contract', () => ({ saveTimeline }))

// The client render as Save & Exit's renderer sees it. Tests move it through
// its states the way a real render would.
const clientRender = vi.hoisted(() => {
  interface RenderState {
    status: string
    progress: number
    result: { blob: Blob } | null
    error: string | null
  }
  const idle: RenderState = { status: 'idle', progress: 0, result: null, error: null }
  let state = idle
  const listeners = new Set<() => void>()
  return {
    startExport: vi.fn<(settings: unknown) => Promise<void>>(async () => {}),
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next: Partial<RenderState>) => {
      state = { ...state, ...next }
      listeners.forEach((listener) => listener())
    },
    reset: () => {
      state = idle
    },
  }
})
vi.mock('../deps/export-contract', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useClientRender: () => ({
      ...useSyncExternalStore(clientRender.subscribe, clientRender.getState),
      startExport: clientRender.startExport,
    }),
  }
})

const ORIGIN = 'http://localhost:8123'

describe('useSendBack (save & exit)', () => {
  beforeEach(() => {
    useEmbeddedStore.setState({
      parentOrigin: null,
      sendBackStatus: 'idle',
      saveExitMode: 'project',
      inputMetadata: null,
    })
    clientRender.startExport.mockClear()
    saveTimeline.mockClear()
    vi.mocked(exportProjectJson).mockClear()
  })

  it.each([
    ['without a saveExit request', undefined],
    ['with saveExit "project"', 'project' as const],
  ])(
    'posts FREECUT_SAVE_EXIT with the project JSON to the parent origin, no render (%s)',
    async (_, saveExit) => {
      useEmbeddedStore.getState().setParentOrigin(ORIGIN)
      if (saveExit) useEmbeddedStore.getState().setSaveExitMode(saveExit)
      const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

      const { result } = renderHook(() => useSendBack())
      await act(() => result.current.saveExit())

      expect(postSpy).toHaveBeenCalledOnce()
      expect(postSpy).toHaveBeenCalledWith(
        {
          type: 'FREECUT_SAVE_EXIT',
          payload: { projectJson: { version: 2, items: [] } },
        },
        ORIGIN,
      )
      expect(clientRender.startExport).not.toHaveBeenCalled()
      expect(result.current.renderer).toBeNull()
      expect(useEmbeddedStore.getState().sendBackStatus).toBe('sent')
      // The project handed back carries the latest edits: the timeline is saved first.
      expect(saveTimeline).toHaveBeenCalledWith('p1')
      const [saved] = saveTimeline.mock.invocationCallOrder
      const [read] = vi.mocked(exportProjectJson).mock.invocationCallOrder
      expect(saved).toBeLessThan(read!)
      postSpy.mockRestore()
    },
  )

  it('does nothing before the parent handshake set an origin', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const { result } = renderHook(() => useSendBack())
    await act(() => result.current.saveExit())

    expect(postSpy).not.toHaveBeenCalled()
    expect(useEmbeddedStore.getState().sendBackStatus).toBe('idle')
    postSpy.mockRestore()
  })
})

/** jsdom's Blob lacks arrayBuffer(); a minimal stand-in carries the bytes. */
function blobOf(bytes: number[]): Blob {
  return {
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Blob
}

/** Mounts the hook as the toolbar does, its renderer beside it, in StrictMode as the app runs. */
function mountSendBack() {
  const sendBack = { current: null as unknown as ReturnType<typeof useSendBack> }
  function SendBackHarness() {
    sendBack.current = useSendBack()
    return sendBack.current.renderer
  }
  render(
    <StrictMode>
      <SendBackHarness />
    </StrictMode>,
  )
  return sendBack
}

const RENDER_SETTINGS = {
  quality: 'high',
  mode: 'video',
  videoContainer: 'mp4',
  renderWholeProject: true,
}

describe('useSendBack (save & exit, saveExit "video")', () => {
  let postSpy: MockInstance<typeof window.parent.postMessage>

  beforeEach(() => {
    clientRender.reset()
    clientRender.startExport.mockClear()
    vi.mocked(exportProjectJson).mockClear()
    useEmbeddedStore.setState({
      parentOrigin: ORIGIN,
      sendBackStatus: 'idle',
      saveExitMode: 'video',
      inputMetadata: { codec: 'hevc', width: 1080, height: 1920, fps: 30 },
    })
    postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  })

  afterEach(() => {
    postSpy.mockRestore()
  })

  function posted(type: string) {
    return postSpy.mock.calls.filter(([message]) => (message as { type?: string }).type === type)
  }

  /** Presses Save & Exit and waits for the render to start; `done` settles with Save & Exit. */
  async function pressSaveExit() {
    const sendBack = mountSendBack()
    let done: Promise<void> = Promise.resolve()
    act(() => {
      done = sendBack.current.saveExit()
    })
    await waitFor(() => expect(clientRender.startExport).toHaveBeenCalled())
    return { sendBack, done }
  }

  it('renders the whole timeline as the source video, then posts FREECUT_EXPORT_COMPLETE with the buffer transferred and the project JSON', async () => {
    const { sendBack, done } = await pressSaveExit()

    expect(clientRender.startExport).toHaveBeenCalledOnce()
    expect(clientRender.startExport).toHaveBeenCalledWith({
      ...RENDER_SETTINGS,
      codec: 'h265',
      resolution: { width: 1080, height: 1920 },
    })
    // The timeline was saved and serialized before the render read it.
    expect(vi.mocked(exportProjectJson).mock.invocationCallOrder[0]).toBeLessThan(
      clientRender.startExport.mock.invocationCallOrder[0] ?? 0,
    )
    expect(sendBack.current.isSaving).toBe(true)

    act(() =>
      clientRender.set({ status: 'completed', progress: 100, result: { blob: blobOf([1, 2, 3]) } }),
    )
    await act(() => done)

    const complete = posted('FREECUT_EXPORT_COMPLETE')
    expect(complete).toHaveLength(1)
    const [message, origin, transfer] = complete[0] as unknown as [
      { type: string; payload: Record<string, unknown> & { videoBuffer: ArrayBuffer } },
      string,
      Transferable[],
    ]
    // No keepOpen: the parent closes the editor on its own.
    expect(Object.keys(message.payload).sort()).toEqual(['projectJson', 'videoBuffer'])
    expect(new Uint8Array(message.payload.videoBuffer)).toEqual(new Uint8Array([1, 2, 3]))
    expect(message.payload.projectJson).toEqual({ version: 2, items: [] })
    expect(origin).toBe(ORIGIN)
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBe(message.payload.videoBuffer)
    expect(posted('FREECUT_SAVE_EXIT')).toHaveLength(0)
    expect(useEmbeddedStore.getState().sendBackStatus).toBe('sent')
    expect(sendBack.current.renderer).toBeNull()
  })

  it('posts FREECUT_EXPORT_PROGRESS (0..1) while it renders, and reports the percentage', async () => {
    const { sendBack, done } = await pressSaveExit()

    act(() => clientRender.set({ status: 'preparing', progress: 0 }))
    act(() => clientRender.set({ status: 'rendering', progress: 42 }))
    act(() => clientRender.set({ status: 'finalizing', progress: 97.5 }))

    expect(posted('FREECUT_EXPORT_PROGRESS')).toEqual([
      [{ type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: 0 } }, ORIGIN],
      [{ type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: 0.42 } }, ORIGIN],
      [{ type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: 0.975 } }, ORIGIN],
    ])
    expect(sendBack.current.progress).toBe(97.5)
    expect(sendBack.current.isSaving).toBe(true)

    act(() =>
      clientRender.set({ status: 'completed', progress: 100, result: { blob: blobOf([7]) } }),
    )
    await act(() => done)
    expect(sendBack.current.progress).toBeNull()
    expect(sendBack.current.isSaving).toBe(false)
  })

  it.each([
    [
      'fails',
      { status: 'failed', error: 'No supported video codecs available in this browser' },
      'No supported video codecs available in this browser',
    ],
    ['is cancelled', { status: 'cancelled' }, 'The render was cancelled'],
  ])(
    'posts FREECUT_ERROR { phase: "export" } and no video when the render %s',
    async (_, outcome, message) => {
      const { sendBack, done } = await pressSaveExit()

      act(() => clientRender.set(outcome))
      await act(() => done)

      expect(posted('FREECUT_ERROR')).toEqual([
        [{ type: 'FREECUT_ERROR', payload: { phase: 'export', message } }, ORIGIN],
      ])
      expect(posted('FREECUT_EXPORT_COMPLETE')).toHaveLength(0)
      expect(useEmbeddedStore.getState().sendBackStatus).toBe('error')
      expect(sendBack.current.renderer).toBeNull()
      expect(sendBack.current.progress).toBeNull()
    },
  )

  it("renders at the project's own frame size, in H.264, when there is no source video metadata", async () => {
    useEmbeddedStore.setState({ inputMetadata: null })
    const { done } = await pressSaveExit()

    expect(clientRender.startExport).toHaveBeenCalledWith({
      ...RENDER_SETTINGS,
      codec: 'h264',
      resolution: { width: 720, height: 1280 },
    })

    act(() =>
      clientRender.set({ status: 'completed', progress: 100, result: { blob: blobOf([5]) } }),
    )
    await act(() => done)
    expect(posted('FREECUT_EXPORT_COMPLETE')).toHaveLength(1)
  })

  it('runs one render at a time', async () => {
    const { sendBack, done } = await pressSaveExit()

    await act(() => sendBack.current.saveExit())
    expect(clientRender.startExport).toHaveBeenCalledOnce()

    act(() =>
      clientRender.set({ status: 'completed', progress: 100, result: { blob: blobOf([1]) } }),
    )
    await act(() => done)
    expect(posted('FREECUT_EXPORT_COMPLETE')).toHaveLength(1)
  })
})
