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
 * - placing files: `placeMedia`, `placeAudio`, `fitItem`, `replaceMedia`;
 * - the project: `setCanvas`, `addMarkers`, `removeMarkers`;
 * - timeline tabs: `createSequence`, `removeSequence`;
 * - color: `applyLook`, `removeEffects`;
 * - `removeItems`: exactly the items named, never the items linked to them;
 * - `duplicateItems`, `splitItems`: a silent copy of clips, and clips split at frames.
 */
import type { EditOp, EditOpEngine } from '@/features/embedded/services/edit-ops-bridge'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { applyOp } from '@/headless/edit-ops'
import { setEditCanvas, type EditOp as HeadlessEditOp } from '@/headless/edit-op-support'
import { applyAddMarkers, applyRemoveMarkers, applySetCanvas } from './embedded-ops/canvas-markers'
import { applyAddTranscriptCaptions } from './embedded-ops/captions'
import { applyDuplicateItems } from './embedded-ops/duplicate-items'
import { applyApplyLook, applyRemoveEffects } from './embedded-ops/looks'
import { applyPlaceAudio, preparePlaceAudio } from './embedded-ops/place-audio'
import { applyFitItem, applyPlaceMedia, preparePlaceMedia } from './embedded-ops/place-media'
import { applyRemoveItems } from './embedded-ops/remove-items'
import { applyReplaceMedia, prepareReplaceMedia } from './embedded-ops/replace-media'
import {
  applyCreateSequence,
  applyRemoveSequence,
  prepareCreateSequence,
} from './embedded-ops/sequences'
import { applySplitItems } from './embedded-ops/split-items'
import { applyRemoveSourceRanges } from './embedded-ops/source-ranges'
import { projectCanvas } from './embedded-ops/timeline-context'

interface ForkOperation {
  prepare?: (op: EditOp) => Promise<EditOp>
  apply: (op: EditOp) => unknown
}

const OPERATIONS: Record<string, ForkOperation> = {
  removeSourceRanges: { apply: applyRemoveSourceRanges },
  removeItems: { apply: applyRemoveItems },
  duplicateItems: { apply: applyDuplicateItems },
  splitItems: { apply: applySplitItems },
  addTranscriptCaptions: { apply: applyAddTranscriptCaptions },
  placeAudio: { prepare: preparePlaceAudio, apply: applyPlaceAudio },
  placeMedia: { prepare: preparePlaceMedia, apply: applyPlaceMedia },
  fitItem: { apply: applyFitItem },
  replaceMedia: { prepare: prepareReplaceMedia, apply: applyReplaceMedia },
  setCanvas: { apply: applySetCanvas },
  addMarkers: { apply: applyAddMarkers },
  removeMarkers: { apply: applyRemoveMarkers },
  createSequence: { prepare: prepareCreateSequence, apply: applyCreateSequence },
  removeSequence: { apply: applyRemoveSequence },
  applyLook: { apply: applyApplyLook },
  removeEffects: { apply: applyRemoveEffects },
}

/**
 * A parent's edit can be many undo entries (a cut each, a file each), and it
 * undoes them all by label later. The history must hold them: an entry that
 * falls off the end can never be undone. So the history keeps at least this
 * many entries while a parent edits (a person's own higher setting stands).
 */
const PARENT_EDIT_HISTORY = 200

function keepHistoryRoom(): void {
  const settings = useSettingsStore.getState()
  if (settings.maxUndoHistory < PARENT_EDIT_HISTORY) {
    useSettingsStore.setState({ maxUndoHistory: PARENT_EDIT_HISTORY })
  }
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
    keepHistoryRoom()
    const operation = operationFor(op)
    return operation ? operation.apply(op) : applyHeadless(op)
  },
}
