/**
 * The edit operations the embedded editor applies for its parent
 * (NODARO_APPLY_OPS, see `features/embedded/services/edit-ops-bridge.ts`).
 *
 * It lives in the app shell because it assembles features, which only a
 * composition root may do (`check:layer-boundaries`): the headless operations
 * engine, the timeline's range removal and the transcript caption builders.
 * The shell loads it on first use, so the editor's first paint does not carry it.
 *
 * Besides every headless operation (`src/headless/edit-ops.ts`), it answers the
 * operations in `./embedded-ops/`, each built from the editor's own actions so
 * it lands exactly as the matching UI action does (each module documents its
 * operations' fields):
 * - media time: `removeSourceRanges`, `addTranscriptCaptions`;
 * - placing files: `placeAudio`.
 */
import type { EditOp, EditOpEngine } from '@/features/embedded/services/edit-ops-bridge'
import { applyOp } from '@/headless/edit-ops'
import { setEditCanvas, type EditOp as HeadlessEditOp } from '@/headless/edit-op-support'
import { applyAddTranscriptCaptions } from './embedded-ops/captions'
import { applyPlaceAudio, preparePlaceAudio } from './embedded-ops/place-audio'
import { applyRemoveSourceRanges } from './embedded-ops/source-ranges'
import { projectCanvas } from './embedded-ops/timeline-context'

interface ForkOperation {
  prepare?: (op: EditOp) => Promise<EditOp>
  apply: (op: EditOp) => unknown
}

const OPERATIONS: Record<string, ForkOperation> = {
  removeSourceRanges: { apply: applyRemoveSourceRanges },
  addTranscriptCaptions: { apply: applyAddTranscriptCaptions },
  placeAudio: { prepare: preparePlaceAudio, apply: applyPlaceAudio },
}

const operationFor = (op: EditOp): ForkOperation | undefined =>
  Object.hasOwn(OPERATIONS, op.op) ? OPERATIONS[op.op] : undefined

/** Every other operation goes to the headless engine, pointed at the open project's canvas. */
function applyHeadless(op: EditOp): unknown {
  const metadata = projectCanvas()
  setEditCanvas({ width: metadata.width, height: metadata.height, fps: metadata.fps })
  return applyOp(op as HeadlessEditOp)
}

export const embeddedEditOpEngine: EditOpEngine = {
  prepare: async (op) => {
    const prepare = operationFor(op)?.prepare
    return prepare ? prepare(op) : op
  },
  apply: (op) => {
    const operation = operationFor(op)
    return operation ? operation.apply(op) : applyHeadless(op)
  },
}
