/**
 * Timeline tabs (sequences) built from media ranges.
 * - `createSequence { name, width?, height?, pieces: [{ mediaId | ref, sourceStart,
 *   sourceEnd, transform? }] }` (source times in seconds): a new top-level
 *   sequence with the pieces back to back on V1 and their linked audio on A1,
 *   built as a media-bin drop builds them. The open tab stays open.
 *   Answers `{ sequenceId, durationInFrames }`.
 * - `removeSequence { sequenceId }` deletes a tab that is not open.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import {
  getActiveTabId,
  useCompositionNavigationStore,
} from '@/features/timeline/stores/composition-navigation-store'
import {
  useCompositionsStore,
  type SubComposition,
} from '@/features/timeline/stores/compositions-store'
import { useSequencesStore } from '@/features/timeline/stores/sequences-store'
import { deleteCompoundClips } from '@/features/timeline/stores/timeline-actions'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { buildMediaTimelineItems } from '@/features/timeline/utils/media-timeline-item-builder'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { TransformProperties } from '@/types/transform'
import { mediaIdOf, prepareMedia, preparedData, type PreparedMedia } from './media-prep'
import {
  CANVAS_HEIGHT_RANGE,
  CANVAS_WIDTH_RANGE,
  fail,
  readEvenDimension,
  requireObjects,
  requireString,
} from './op-fields'
import { projectCanvas, timelineFps } from './timeline-context'

/** How far past a file's end a range may reach (rounding in the parent's seconds). */
const END_TOLERANCE_SECONDS = 0.05

type PieceTransform = Pick<TransformProperties, 'x' | 'y' | 'width' | 'height'>

interface PreparedPiece extends PreparedMedia {
  readonly start: number
  readonly end: number
  readonly transform?: PieceTransform
}

const prepared = preparedData<PreparedPiece[]>('createSequence')

function readPieceTransform(op: EditOp, value: unknown, path: string): PieceTransform | undefined {
  if (value === undefined) return undefined
  const { x, y, width, height } = (value ?? {}) as Record<string, unknown>
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) {
    fail(op, `${path} needs x, y, width and height in pixels`)
  }
  if ((width as number) <= 0 || (height as number) <= 0) {
    fail(op, `${path} needs a width and height above 0`)
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number }
}

function readPieceRange(
  op: EditOp,
  entry: Record<string, unknown>,
  path: string,
  media: PreparedMedia,
): { start: number; end: number } {
  const { sourceStart, sourceEnd } = entry
  if (
    typeof sourceStart !== 'number' ||
    typeof sourceEnd !== 'number' ||
    !Number.isFinite(sourceStart) ||
    !(sourceEnd > sourceStart) ||
    sourceStart < 0
  ) {
    fail(op, `${path} needs a sourceStart and a later sourceEnd, in seconds`)
  }
  if (media.kind === 'image') return { start: sourceStart, end: sourceEnd }
  const length = media.media.duration
  if (sourceEnd > length + END_TOLERANCE_SECONDS) {
    fail(
      op,
      `${path} ends at ${sourceEnd} s, past the end of ${media.media.fileName} (${length} s)`,
    )
  }
  return { start: sourceStart, end: Math.min(sourceEnd, length) }
}

export async function prepareCreateSequence(op: EditOp): Promise<EditOp> {
  const entries = requireObjects(op, 'pieces', '{ mediaId, sourceStart, sourceEnd }')
  const pieces: PreparedPiece[] = []
  for (const [index, entry] of entries.entries()) {
    const path = `pieces[${index}]`
    const mediaId = await mediaIdOf(op, entry, { id: 'mediaId', ref: 'ref', path })
    const media = await prepareMedia(op, mediaId)
    const transform = readPieceTransform(op, entry.transform, `${path}.transform`)
    if (transform && media.kind === 'audio') {
      fail(op, `${path}.transform applies to a video or image piece`)
    }
    pieces.push({ ...media, ...readPieceRange(op, entry, path, media), transform })
  }
  return prepared.attach(op, pieces)
}

/** The source frames of a piece, and how many timeline frames it lasts. */
function pieceTiming(piece: PreparedPiece, fps: number) {
  const sourceFps = piece.media.fps || fps
  if (piece.kind === 'image') {
    return { durationInFrames: Math.max(1, Math.round((piece.end - piece.start) * fps)) }
  }
  const sourceStart = Math.round(piece.start * sourceFps)
  const sourceEnd = Math.max(sourceStart + 1, Math.round(piece.end * sourceFps))
  const durationInFrames = Math.max(1, Math.round(((sourceEnd - sourceStart) * fps) / sourceFps))
  return { durationInFrames, sourceStart, sourceEnd }
}

interface SequenceCanvas {
  width: number
  height: number
  fps: number
}

function buildPieceItems(
  piece: PreparedPiece,
  from: number,
  tracks: { video: TimelineTrack; audio: TimelineTrack },
  canvas: SequenceCanvas,
): { items: TimelineItem[]; durationInFrames: number } {
  const { durationInFrames, sourceStart, sourceEnd } = pieceTiming(piece, canvas.fps)
  const withAudio = piece.kind === 'video' && !!piece.media.audioCodec
  const primaryTrack = piece.kind === 'audio' ? tracks.audio : tracks.video
  const items = buildMediaTimelineItems({
    media: piece.media,
    mediaId: piece.media.id,
    mediaType: piece.kind,
    label: piece.media.fileName,
    projectFps: canvas.fps,
    blobUrl: piece.blobUrl,
    thumbnailUrl: null,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    placements: {
      primary: { trackId: primaryTrack.id, from, durationInFrames },
      ...(withAudio ? { linkedAudio: { trackId: tracks.audio.id, from, durationInFrames } } : {}),
    },
    linkVideoAudio: withAudio,
    ...(sourceStart === undefined ? {} : { sourceStart, sourceEnd }),
  })
  const framed = piece.transform
    ? items.map((item) =>
        item.type === 'audio'
          ? item
          : { ...item, transform: { ...item.transform, ...piece.transform } },
      )
    : items
  return { items: framed, durationInFrames }
}

function readSequenceCanvas(op: EditOp): SequenceCanvas {
  const project = projectCanvas()
  const width =
    op.width === undefined
      ? project.width
      : readEvenDimension(op, op.width, 'width', CANVAS_WIDTH_RANGE.min, CANVAS_WIDTH_RANGE.max)
  const height =
    op.height === undefined
      ? project.height
      : readEvenDimension(op, op.height, 'height', CANVAS_HEIGHT_RANGE.min, CANVAS_HEIGHT_RANGE.max)
  return { width, height, fps: timelineFps() }
}

export function applyCreateSequence(op: EditOp): unknown {
  const pieces = prepared.read(op)
  const name = requireString(op, 'name').trim()
  if (!name) fail(op, '`name` must not be blank')
  const canvas = readSequenceCanvas(op)
  const video = createClassicTrack({ tracks: [], kind: 'video', order: 0 })
  const audio = createClassicTrack({ tracks: [video], kind: 'audio', order: 1 })

  let durationInFrames = 0
  const items: TimelineItem[] = []
  for (const piece of pieces) {
    const built = buildPieceItems(piece, durationInFrames, { video, audio }, canvas)
    items.push(...built.items)
    durationInFrames += built.durationInFrames
  }

  const backgroundColor = projectCanvas().backgroundColor
  const sequence: SubComposition = {
    id: crypto.randomUUID(),
    name,
    editorKind: 'sequence',
    items,
    tracks: [video, audio],
    transitions: [],
    keyframes: [],
    fps: canvas.fps,
    width: canvas.width,
    height: canvas.height,
    durationInFrames,
    ...(backgroundColor ? { backgroundColor } : {}),
  }
  // The editor's own createSequence also switches to the new tab; a batch must
  // never switch tabs (history is kept per tab), so the tab is only added.
  useCompositionsStore.getState().addComposition(sequence)
  useSequencesStore.getState().addTopLevelSequence(sequence.id)
  useTimelineSettingsStore.getState().markDirty()
  return { sequenceId: sequence.id, durationInFrames }
}

export function applyRemoveSequence(op: EditOp): unknown {
  const sequenceId = requireString(op, 'sequenceId')
  const isTab =
    useSequencesStore.getState().topLevelSequenceIds.includes(sequenceId) &&
    !!useCompositionsStore.getState().compositionById[sequenceId]
  if (!isTab) fail(op, `sequence "${sequenceId}" is not a timeline tab`)
  const { breadcrumbs } = useCompositionNavigationStore.getState()
  if (getActiveTabId(breadcrumbs) === sequenceId) {
    fail(op, 'the open timeline tab cannot be removed; open another tab first')
  }
  if (breadcrumbs.some((crumb) => crumb.compositionId === sequenceId)) {
    fail(op, `sequence "${sequenceId}" is open in the editor`)
  }
  if (!deleteCompoundClips([sequenceId])) fail(op, `sequence "${sequenceId}" could not be removed`)
  return { sequenceId }
}
