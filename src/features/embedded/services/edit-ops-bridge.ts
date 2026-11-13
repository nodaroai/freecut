import { createLogger } from '@/shared/logging/logger'
import type { TimelineItem } from '@/types/timeline'
import {
  useItemsStore,
  useTimelineCommandStore,
  useTimelineSettingsStore,
} from '../deps/timeline-contract'
import { useProjectStore } from '../deps/projects-contract'
import { useMediaLibraryStore } from '../deps/media-library-contract'
import { mediaIdForRef } from './imported-refs'
import { waitUntilEditable } from './edit-readiness'

const log = createLogger('embedded-edit-ops')

/** One edit operation as a parent sends it: `op` names it, the other keys are its fields. */
export type EditOp = Record<string, unknown> & { op: string }

/**
 * Applies edit operations to the live timeline. Its pieces live in the app
 * shell (the headless operations engine, the timeline's own range removal and
 * caption builders), which a feature may not import (`check:layer-boundaries`),
 * so the shell passes a loader in.
 * - `prepare` does what an operation needs before the timeline changes (reading
 *   media from storage, say), outside the history entry.
 * - `apply` changes the timeline, synchronously, inside the batch.
 */
export interface EditOpEngine {
  prepare(op: EditOp): Promise<EditOp>
  apply(op: EditOp): unknown
}

export type LoadEditOps = () => Promise<EditOpEngine>

/** The most operations one request may carry. */
const MAX_OPS = 500

let loadEngine: LoadEditOps | null = null
let engine: Promise<EditOpEngine> | null = null
// Requests run one at a time, in arrival order: each reads the timeline the previous one left.
let queue: Promise<void> = Promise.resolve()

export function setEditOpsLoader(load: LoadEditOps | null): void {
  loadEngine = load
  engine = null
}

export function editOpsAvailable(): boolean {
  return loadEngine !== null
}

function getEngine(): Promise<EditOpEngine> {
  if (!loadEngine) return Promise.reject(new Error('This editor cannot apply edit operations'))
  if (!engine) {
    engine = loadEngine().catch((error: unknown) => {
      engine = null
      throw error
    })
  }
  return engine
}

type Reply = (type: string, payload: Record<string, unknown>) => void

function replyTo(event: MessageEvent, requestId: string): Reply {
  return (type, payload) =>
    window.parent.postMessage({ type, payload: { requestId, ...payload } }, event.origin)
}

/** Where a video or audio item's footage starts and ends, so a parent can map media time to the timeline. */
function sourceFields(item: TimelineItem) {
  if (item.type !== 'video' && item.type !== 'audio') return {}
  return {
    ...(item.sourceStart === undefined ? {} : { sourceStart: item.sourceStart }),
    ...(item.sourceEnd === undefined ? {} : { sourceEnd: item.sourceEnd }),
    ...(item.sourceFps === undefined ? {} : { sourceFps: item.sourceFps }),
    ...(item.speed === undefined ? {} : { speed: item.speed }),
  }
}

/** What a parent sees of the timeline: enough to plan edits, nothing the editor keeps private. */
function readTimeline() {
  const { tracks, items } = useItemsStore.getState()
  const metadata = useProjectStore.getState().currentProject?.metadata
  return {
    fps: useTimelineSettingsStore.getState().fps || metadata?.fps || 30,
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    durationInFrames: items.reduce(
      (end, item) => Math.max(end, item.from + item.durationInFrames),
      0,
    ),
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind ?? null,
      order: track.order,
    })),
    items: items.map((item) => ({
      id: item.id,
      type: item.type,
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      ...(item.label ? { label: item.label } : {}),
      ...('mediaId' in item && item.mediaId ? { mediaId: item.mediaId } : {}),
      ...('text' in item && typeof item.text === 'string' ? { text: item.text } : {}),
      ...sourceFields(item),
    })),
    media: useMediaLibraryStore.getState().mediaItems.map((media) => ({
      id: media.id,
      fileName: media.fileName,
      mimeType: media.mimeType,
      duration: media.duration,
      width: media.width,
      height: media.height,
      fps: media.fps,
    })),
  }
}

/** The first entry that is not an operation, or -1 when every entry is one. */
function firstInvalid(ops: readonly unknown[]): number {
  return ops.findIndex(
    (op) => !op || typeof op !== 'object' || typeof (op as { op?: unknown }).op !== 'string',
  )
}

/** An operation that names a file by the parent's `ref` gets the media id it was imported as. */
async function withMediaId(op: EditOp): Promise<EditOp> {
  if (typeof op.mediaId === 'string' || typeof op.ref !== 'string') return op
  const mediaId = await mediaIdForRef(op.ref)
  if (!mediaId) throw new Error(`"${op.ref}" is not in Media`)
  return { ...op, mediaId }
}

class OpFailure extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message)
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation failed'

async function applyRequest(ops: EditOp[], label: unknown) {
  const projectId = await waitUntilEditable()
  const loaded = await getEngine()
  const prepared: EditOp[] = []
  for (const [index, op] of ops.entries()) {
    try {
      prepared.push(await loaded.prepare(await withMediaId(op)))
    } catch (error) {
      throw new OpFailure(messageOf(error), index)
    }
  }

  // Preparing awaited storage: the editor may have moved on since. The checks
  // and the batch below run with no await between them, so they hold together.
  if ((await waitUntilEditable()) !== projectId) {
    throw new Error('The project changed while the edit was being prepared')
  }

  const command = {
    type: 'APPLY_EDIT_OPS',
    payload: { count: ops.length, ...(typeof label === 'string' && label ? { label } : {}) },
  }
  const history = useTimelineCommandStore.getState()
  const topBefore = history.undoStack.at(-1)
  let index = 0
  try {
    const results = history.executeBatch(command, () =>
      prepared.map((op, i) => {
        index = i
        return loaded.apply(op)
      }),
    )
    // A request that changed nothing makes no undo entry, and says so.
    const recorded = useTimelineCommandStore.getState().undoStack.at(-1) !== topBefore
    return { results, recorded }
  } catch (error) {
    throw new OpFailure(messageOf(error), index)
  }
}

/**
 * NODARO_APPLY_OPS { requestId, label?, ops } → FREECUT_OPS_RESULT.
 * The operations apply in order as ONE undo entry. When one fails, the whole
 * request is rolled back and the reply names the failing operation's index.
 */
export function handleApplyOps(event: MessageEvent): Promise<void> {
  const { requestId, label, ops } = (event.data?.payload ?? {}) as {
    requestId?: unknown
    label?: unknown
    ops?: unknown
  }
  if (typeof requestId !== 'string') return Promise.resolve()
  const reply = replyTo(event, requestId)
  const refuse = (message: string, index?: number) =>
    reply('FREECUT_OPS_RESULT', {
      ok: false,
      error: { message, ...(index === undefined ? {} : { index }) },
    })

  if (!editOpsAvailable()) {
    refuse('This editor cannot apply edit operations')
    return Promise.resolve()
  }
  if (!Array.isArray(ops) || ops.length === 0) {
    refuse('Send at least one operation')
    return Promise.resolve()
  }
  if (ops.length > MAX_OPS) {
    refuse(`Send at most ${MAX_OPS} operations at once`)
    return Promise.resolve()
  }
  const invalid = firstInvalid(ops)
  if (invalid >= 0) {
    refuse('Every operation needs an op name', invalid)
    return Promise.resolve()
  }

  const run = async () => {
    let outcome: Awaited<ReturnType<typeof applyRequest>>
    try {
      outcome = await applyRequest(ops as EditOp[], label)
    } catch (error) {
      log.warn('NODARO_APPLY_OPS rolled back:', error)
      return refuse(messageOf(error), error instanceof OpFailure ? error.index : undefined)
    }
    // The edit has landed: a failure to send the reply is not a rollback.
    reply('FREECUT_OPS_RESULT', { ok: true, ...outcome, timeline: readTimeline() })
  }
  queue = queue.then(run, run)
  return queue
}

/** The label a parent gave the edit request on top of the undo history, or null when the top is not one. */
function topEditRequestLabel(): string | null {
  const top = useTimelineCommandStore.getState().undoStack.at(-1)?.command
  if (top?.type !== 'APPLY_EDIT_OPS') return null
  const label = top.payload?.label
  return typeof label === 'string' ? label : ''
}

/**
 * NODARO_UNDO_EDIT { requestId, label? } → FREECUT_UNDO_RESULT { requestId, undone, timeline }.
 * Undoes the newest history entry only when it is an edit request a parent
 * sent (and, given a label, the one with that label), so a parent rewinding
 * its own steps never undoes an edit the person made by hand.
 */
export function handleUndoEdit(event: MessageEvent): Promise<void> {
  const { requestId, label } = (event.data?.payload ?? {}) as {
    requestId?: unknown
    label?: unknown
  }
  if (typeof requestId !== 'string') return Promise.resolve()
  const run = () => {
    const top = topEditRequestLabel()
    const undone = top !== null && (typeof label !== 'string' || label === top)
    if (undone) useTimelineCommandStore.getState().undo()
    replyTo(event, requestId)('FREECUT_UNDO_RESULT', { undone, timeline: readTimeline() })
  }
  queue = queue.then(run, run)
  return queue
}

/**
 * NODARO_GET_TIMELINE { requestId } → FREECUT_TIMELINE { requestId, timeline }.
 * Queued behind any running edit request, so it reads what that request left.
 */
export function handleGetTimeline(event: MessageEvent): Promise<void> {
  const { requestId } = (event.data?.payload ?? {}) as { requestId?: unknown }
  if (typeof requestId !== 'string') return Promise.resolve()
  const run = () => replyTo(event, requestId)('FREECUT_TIMELINE', { timeline: readTimeline() })
  queue = queue.then(run, run)
  return queue
}
