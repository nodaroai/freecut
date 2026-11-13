import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The bridge reads the live stores through the feature's adapters; these
// stand-ins give it one track, one clip and one media file, and run a batch by
// calling it (the batch's own undo and rollback are covered by the store test).
const executeBatch = vi.fn((_command: unknown, action: () => unknown) => action())
const project = vi.hoisted(() => ({
  current: { id: 'p1', metadata: { width: 1080, height: 1920, fps: 30 } } as unknown,
}))
const history = vi.hoisted(() => ({
  undoStack: [] as Array<{ command: { type: string; payload?: Record<string, unknown> } }>,
  undo: vi.fn(),
}))
vi.mock('../deps/timeline-contract', () => ({
  useItemsStore: {
    getState: () => ({
      tracks: [{ id: 'v1', name: 'V1', kind: 'video', order: 0 }],
      items: [
        {
          id: 'clip-1',
          type: 'video',
          trackId: 'v1',
          from: 0,
          durationInFrames: 120,
          label: 'take.mp4',
          mediaId: 'm1',
          sourceStart: 0,
          sourceEnd: 120,
          sourceFps: 30,
        },
      ],
    }),
  },
  useTimelineSettingsStore: { getState: () => ({ fps: 30 }) },
  useTimelineCommandStore: {
    getState: () => ({ executeBatch, undoStack: history.undoStack, undo: history.undo }),
  },
}))
vi.mock('../deps/projects-contract', () => ({
  useProjectStore: { getState: () => ({ currentProject: project.current }) },
}))
vi.mock('../deps/media-library-contract', () => ({
  useMediaLibraryStore: {
    getState: () => ({
      mediaItems: [
        {
          id: 'm1',
          fileName: 'take.mp4',
          mimeType: 'video/mp4',
          duration: 4,
          width: 1920,
          height: 1080,
          fps: 30,
        },
      ],
    }),
  },
}))

import {
  handleApplyOps,
  handleGetTimeline,
  handleUndoEdit,
  setEditOpsLoader,
  type EditOp,
  type EditOpEngine,
} from './edit-ops-bridge'
import { claimImportedRef } from './imported-refs'

const ORIGIN = 'http://localhost:5173'
const message = (type: string, payload: Record<string, unknown>) =>
  new MessageEvent('message', { data: { type, payload }, origin: ORIGIN })

let post: ReturnType<typeof vi.spyOn>
const lastReply = () =>
  post.mock.calls.at(-1) as [{ type: string; payload: Record<string, unknown> }, string]

function engineOf(apply: (op: EditOp) => unknown, prepare?: (op: EditOp) => Promise<EditOp>) {
  const engine: EditOpEngine = { prepare: prepare ?? (async (op) => op), apply }
  setEditOpsLoader(async () => engine)
}

beforeEach(() => {
  executeBatch.mockClear()
  project.current = { id: 'p1', metadata: { width: 1080, height: 1920, fps: 30 } }
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
})
afterEach(() => {
  post.mockRestore()
  setEditOpsLoader(null)
})

describe('NODARO_APPLY_OPS', () => {
  it('applies the operations in order as one batch and answers with the timeline', async () => {
    const seen: string[] = []
    engineOf((op) => {
      seen.push(op.op)
      return { id: `${op.op}-done` }
    })

    await handleApplyOps(
      message('NODARO_APPLY_OPS', {
        requestId: 'r1',
        label: 'Cut the pauses',
        ops: [{ op: 'split' }, { op: 'removeItems' }],
      }),
    )

    expect(seen).toEqual(['split', 'removeItems'])
    expect(executeBatch).toHaveBeenCalledTimes(1)
    expect(executeBatch.mock.calls[0]![0]).toEqual({
      type: 'APPLY_EDIT_OPS',
      payload: { count: 2, label: 'Cut the pauses' },
    })
    const [reply, origin] = lastReply()
    expect(origin).toBe(ORIGIN)
    expect(reply.type).toBe('FREECUT_OPS_RESULT')
    expect(reply.payload).toMatchObject({
      requestId: 'r1',
      ok: true,
      results: [{ id: 'split-done' }, { id: 'removeItems-done' }],
      timeline: { fps: 30, width: 1080, height: 1920, durationInFrames: 120 },
    })
  })

  it('prepares every operation before the batch starts', async () => {
    const order: string[] = []
    engineOf(
      (op) => order.push(`apply ${op.op}`),
      async (op) => {
        order.push(`prepare ${op.op}`)
        return op
      },
    )

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'r2', ops: [{ op: 'a' }, { op: 'b' }] }),
    )

    expect(order).toEqual(['prepare a', 'prepare b', 'apply a', 'apply b'])
  })

  it('names the operation that failed', async () => {
    engineOf((op) => {
      if (op.op === 'trimEnd') throw new Error('trimEnd requires `id` and `amount`')
      return {}
    })

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'r3', ops: [{ op: 'split' }, { op: 'trimEnd' }] }),
    )

    expect(lastReply()[0].payload).toEqual({
      requestId: 'r3',
      ok: false,
      error: { message: 'trimEnd requires `id` and `amount`', index: 1 },
    })
  })

  it('names the operation whose preparation failed, and applies nothing', async () => {
    const apply = vi.fn()
    engineOf(apply, async (op) => {
      if (op.op === 'placeAudio') throw new Error('Media x is not in Media')
      return op
    })

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'r4', ops: [{ op: 'a' }, { op: 'placeAudio' }] }),
    )

    expect(lastReply()[0].payload).toEqual({
      requestId: 'r4',
      ok: false,
      error: { message: 'Media x is not in Media', index: 1 },
    })
    expect(apply).not.toHaveBeenCalled()
    expect(executeBatch).not.toHaveBeenCalled()
  })

  it('gives an operation that names a ref the media id it was imported as', async () => {
    const seen: EditOp[] = []
    engineOf((op) => seen.push(op))
    claimImportedRef('music')('media-music')

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'r5', ops: [{ op: 'placeAudio', ref: 'music' }] }),
    )

    expect(seen[0]).toMatchObject({ op: 'placeAudio', ref: 'music', mediaId: 'media-music' })
  })

  it('refuses when no project is open', async () => {
    engineOf(vi.fn())
    project.current = null

    await handleApplyOps(message('NODARO_APPLY_OPS', { requestId: 'r6', ops: [{ op: 'split' }] }))

    expect(lastReply()[0].payload).toEqual({
      requestId: 'r6',
      ok: false,
      error: { message: 'No project is open' },
    })
  })

  it('refuses when the app shell passed no operations engine', async () => {
    await handleApplyOps(message('NODARO_APPLY_OPS', { requestId: 'r7', ops: [{ op: 'split' }] }))

    expect(lastReply()[0].payload).toEqual({
      requestId: 'r7',
      ok: false,
      error: { message: 'This editor cannot apply edit operations' },
    })
    expect(executeBatch).not.toHaveBeenCalled()
  })

  it('refuses an entry that is not an operation, before applying anything', async () => {
    const apply = vi.fn()
    engineOf(apply)

    await handleApplyOps(
      message('NODARO_APPLY_OPS', { requestId: 'r8', ops: [{ op: 'split' }, { id: 'x' }] }),
    )

    expect(lastReply()[0].payload).toEqual({
      requestId: 'r8',
      ok: false,
      error: { message: 'Every operation needs an op name', index: 1 },
    })
    expect(apply).not.toHaveBeenCalled()
  })

  it('ignores a message without a request id', async () => {
    engineOf(vi.fn())

    await handleApplyOps(message('NODARO_APPLY_OPS', { ops: [{ op: 'split' }] }))

    expect(post).not.toHaveBeenCalled()
  })
})

describe('NODARO_UNDO_EDIT', () => {
  beforeEach(() => {
    history.undo.mockClear()
    history.undoStack.length = 0
  })

  it('undoes the newest step when it is an edit request with that label', async () => {
    history.undoStack.push({ command: { type: 'APPLY_EDIT_OPS', payload: { label: 'Captions' } } })

    await handleUndoEdit(message('NODARO_UNDO_EDIT', { requestId: 'u1', label: 'Captions' }))

    expect(history.undo).toHaveBeenCalledTimes(1)
    expect(lastReply()[0]).toMatchObject({
      type: 'FREECUT_UNDO_RESULT',
      payload: { requestId: 'u1', undone: true },
    })
  })

  it('leaves an edit the person made by hand alone', async () => {
    history.undoStack.push({ command: { type: 'MOVE_ITEM' } })

    await handleUndoEdit(message('NODARO_UNDO_EDIT', { requestId: 'u2' }))

    expect(history.undo).not.toHaveBeenCalled()
    expect(lastReply()[0].payload).toMatchObject({ requestId: 'u2', undone: false })
  })

  it('leaves an edit request with another label alone', async () => {
    history.undoStack.push({ command: { type: 'APPLY_EDIT_OPS', payload: { label: 'Music' } } })

    await handleUndoEdit(message('NODARO_UNDO_EDIT', { requestId: 'u3', label: 'Captions' }))

    expect(history.undo).not.toHaveBeenCalled()
  })
})

describe('NODARO_GET_TIMELINE', () => {
  it('answers the tracks, items with their source span, and media', async () => {
    await handleGetTimeline(message('NODARO_GET_TIMELINE', { requestId: 't1' }))

    const [reply] = lastReply()
    expect(reply.type).toBe('FREECUT_TIMELINE')
    expect(reply.payload).toEqual({
      requestId: 't1',
      timeline: {
        fps: 30,
        width: 1080,
        height: 1920,
        durationInFrames: 120,
        tracks: [{ id: 'v1', name: 'V1', kind: 'video', order: 0 }],
        items: [
          {
            id: 'clip-1',
            type: 'video',
            trackId: 'v1',
            from: 0,
            durationInFrames: 120,
            label: 'take.mp4',
            mediaId: 'm1',
            sourceStart: 0,
            sourceEnd: 120,
            sourceFps: 30,
          },
        ],
        media: [
          {
            id: 'm1',
            fileName: 'take.mp4',
            mimeType: 'video/mp4',
            duration: 4,
            width: 1920,
            height: 1080,
            fps: 30,
          },
        ],
      },
    })
  })
})
