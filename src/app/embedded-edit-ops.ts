/**
 * The edit operations the embedded editor applies for its parent
 * (NODARO_APPLY_OPS, see `features/embedded/services/edit-ops-bridge.ts`).
 *
 * It lives in the app shell because it assembles features, which only a
 * composition root may do (`check:layer-boundaries`): the headless operations
 * engine, the timeline's range removal and the transcript caption builders.
 * The shell loads it on first use, so the editor's first paint does not carry it.
 *
 * Besides every headless operation (`src/headless/edit-ops.ts`), it answers
 * three that work on media time rather than on timeline frames, built from the
 * editor's own actions so each lands exactly as the matching UI action does:
 * - `removeSourceRanges { mediaId, ranges: [{ start, end }] }`: cut those
 *   seconds of the media out of every clip of it, and close the gaps (the same
 *   split-then-ripple removal as Remove silence).
 * - `addTranscriptCaptions { mediaId, cues: [{ text, start, end }], stylePresetId? }`:
 *   caption every clip of the media from cues in media seconds (the same
 *   caption segments as Insert transcript as captions).
 * - `placeAudio { mediaId, from?, durationInFrames?, volumeDb?, fadeOutSeconds?, newTrack? }`:
 *   put an audio file on an audio track at a frame (a new track below the
 *   others when asked or when none has room), built as a media-bin drop is.
 *   A video file is refused: placing one would need its linked audio as well.
 */
import type { EditOp, EditOpEngine } from '@/features/embedded/services/edit-ops-bridge'
import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { getMediaType } from '@/features/media-library/utils/validation'
import {
  buildCaptionTrackAbove,
  buildSubtitleSegmentForClip,
  findCompatibleCaptionTrackForRanges,
  getCaptionRangeForClip,
  getCaptionStyleTemplateFromPreset,
} from '@/features/media-library/utils/caption-items'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { removeTranscriptRangesFromItems } from '@/features/timeline/stores/actions/edit/range-removal-actions'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addItem, addItems, setTracks } from '@/features/timeline/stores/timeline-actions'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { createClassicTrack, getTrackKind } from '@/features/timeline/utils/classic-tracks'
import { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils'
import {
  buildDroppedMediaTimelineItem,
  getDroppedMediaDurationInFrames,
} from '@/features/timeline/utils/dropped-media'
import { applyOp } from '@/headless/edit-ops'
import { setEditCanvas, type EditOp as HeadlessEditOp } from '@/headless/edit-op-support'
import type { MediaMetadata } from '@/types/storage'
import type { AudioItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'

// ── reading an operation's fields ────────────────────────────────────────────

function requireString(op: EditOp, field: string): string {
  const value = op[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${op.op} requires \`${field}\``)
  }
  return value
}

function optionalNumber(op: EditOp, field: string): number | undefined {
  const value = op[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${op.op}: \`${field}\` must be a number`)
  }
  return value
}

interface SecondsRange {
  start: number
  end: number
}

function requireRanges(op: EditOp, field: string): SecondsRange[] {
  const value = op[field]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${op.op} requires \`${field}\`, a list of { start, end } in seconds`)
  }
  return value.map((entry, index) => {
    const { start, end } = (entry ?? {}) as { start?: unknown; end?: unknown }
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start < 0) {
      throw new Error(`${op.op}: ${field}[${index}] needs a start and a later end, in seconds`)
    }
    return { start, end }
  })
}

// ── the clips of one media file ──────────────────────────────────────────────

type MediaClip = AudioItem | VideoItem

const isMediaClip = (item: TimelineItem, mediaId: string): item is MediaClip =>
  (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId

function clipsOf(mediaId: string): MediaClip[] {
  const clips = useItemsStore.getState().items.filter((item) => isMediaClip(item, mediaId))
  if (clips.length === 0) throw new Error(`No clip of media ${mediaId} is on the timeline`)
  return clips
}

function projectCanvas() {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('No project is open')
  return project.metadata
}

// ── removeSourceRanges ───────────────────────────────────────────────────────

function applyRemoveSourceRanges(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const ranges = requireRanges(op, 'ranges')
  const result = removeTranscriptRangesFromItems(
    clipsOf(mediaId).map((clip) => clip.id),
    { [mediaId]: ranges },
  )
  if (result.removedRangeCount === 0) {
    throw new Error('None of the ranges could be cut from the clips on the timeline')
  }
  return { removedRangeCount: result.removedRangeCount, removedItemCount: result.removedItemCount }
}

// ── addTranscriptCaptions ────────────────────────────────────────────────────

interface CaptionCue {
  text: string
  start: number
  end: number
}

function requireCues(op: EditOp): CaptionCue[] {
  const value = op.cues
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${op.op} requires \`cues\`, a list of { text, start, end } in seconds`)
  }
  return value.map((entry, index) => {
    const { text, start, end } = (entry ?? {}) as { text?: unknown; start?: unknown; end?: unknown }
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(`${op.op}: cues[${index}] needs text`)
    }
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start < 0) {
      throw new Error(`${op.op}: cues[${index}] needs a start and a later end, in seconds`)
    }
    return { text: text.trim(), start, end }
  })
}

function applyAddTranscriptCaptions(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const cues = requireCues(op)
  const metadata = projectCanvas()
  const clips = clipsOf(mediaId)
  // Caption the picture; an audio-only media file is captioned on its audio clips.
  const targets = clips.some((clip) => clip.type === 'video')
    ? clips.filter((clip) => clip.type === 'video')
    : clips
  const fps = useTimelineSettingsStore.getState().fps || metadata.fps
  const presetId =
    typeof op.stylePresetId === 'string'
      ? op.stylePresetId
      : useSettingsStore.getState().defaultCaptionStylePresetId
  const styleTemplate = getCaptionStyleTemplateFromPreset(presetId, metadata.width, metadata.height)
  const segments = cues.map(({ text, start, end }) => ({ text, start, end }))
  const subtitleCues = cues.map((cue, index) => ({
    id: `caption-${mediaId}-${index}`,
    startSeconds: cue.start,
    endSeconds: cue.end,
    text: cue.text,
  }))

  const { items, tracks } = useItemsStore.getState()
  const newTracks: TimelineTrack[] = [...tracks]
  const planned: TimelineItem[] = [...items]
  const inserted: TimelineItem[] = []

  for (const clip of targets.toSorted((a, b) => a.from - b.from)) {
    const range = getCaptionRangeForClip(clip, segments, fps)
    if (!range) continue
    let track = findCompatibleCaptionTrackForRanges(newTracks, planned, [range])
    if (!track) {
      const clipTrack = newTracks.find((candidate) => candidate.id === clip.trackId)
      track = buildCaptionTrackAbove(newTracks, clipTrack?.order ?? 0)
      newTracks.push(track)
      newTracks.sort((a, b) => a.order - b.order)
    }
    const caption = buildSubtitleSegmentForClip({
      trackId: track.id,
      cues: subtitleCues,
      clip,
      timelineFps: fps,
      canvasWidth: metadata.width,
      canvasHeight: metadata.height,
      label: 'Captions',
      source: { type: 'transcript', mediaId, clipId: clip.id },
      styleTemplate,
    })
    if (!caption) continue
    inserted.push(caption)
    planned.push(caption)
  }

  if (inserted.length === 0) throw new Error('None of the cues falls inside a clip on the timeline')
  if (newTracks.length !== tracks.length) setTracks(newTracks)
  addItems(inserted)
  return { insertedItemCount: inserted.length, ids: inserted.map((item) => item.id) }
}

// ── placeAudio ───────────────────────────────────────────────────────────────

interface PreparedAudio {
  media: MediaMetadata
  blobUrl: string
}

const preparedAudio = new WeakMap<EditOp, PreparedAudio>()

async function preparePlaceAudio(op: EditOp): Promise<EditOp> {
  const mediaId = requireString(op, 'mediaId')
  const media = await mediaLibraryService.getMedia(mediaId)
  if (!media) throw new Error(`Media ${mediaId} is not in Media`)
  if (getMediaType(media.mimeType) !== 'audio') {
    throw new Error(`placeAudio places an audio file; ${media.fileName} is not one`)
  }
  const blobUrl = await resolveMediaUrl(mediaId)
  if (!blobUrl) throw new Error(`Media ${mediaId} could not be read`)
  const prepared = { ...op }
  preparedAudio.set(prepared, { media, blobUrl })
  return prepared
}

/** An audio track with room for the whole span at `from`, or a new one below the others. */
function audioTrackFor(from: number, durationInFrames: number, forceNew: boolean) {
  const { tracks, items } = useItemsStore.getState()
  if (!forceNew) {
    const free = tracks
      .filter((track) => !track.isGroup && !track.locked && getTrackKind(track) === 'audio')
      .toSorted((a, b) => a.order - b.order)
      .find((track) => findNearestAvailableSpace(from, durationInFrames, track.id, items) === from)
    if (free) return free.id
  }
  const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
  const track = createClassicTrack({ tracks, kind: 'audio', order })
  setTracks([...tracks, track])
  return track.id
}

function applyPlaceAudio(op: EditOp): unknown {
  const prepared = preparedAudio.get(op)
  if (!prepared) throw new Error('placeAudio was not prepared')
  const { media, blobUrl } = prepared
  const metadata = projectCanvas()
  const fps = useTimelineSettingsStore.getState().fps || metadata.fps
  const from = Math.max(0, Math.round(optionalNumber(op, 'from') ?? 0))
  const fullLength = getDroppedMediaDurationInFrames(media, 'audio', fps)
  const asked = optionalNumber(op, 'durationInFrames')
  const durationInFrames = Math.max(1, Math.min(fullLength, Math.round(asked ?? fullLength)))
  const trackId = audioTrackFor(from, durationInFrames, op.newTrack === true)

  const item = buildDroppedMediaTimelineItem({
    media,
    mediaId: media.id,
    mediaType: 'audio',
    label: typeof op.label === 'string' && op.label ? op.label : media.fileName,
    timelineFps: fps,
    blobUrl,
    canvasWidth: metadata.width,
    canvasHeight: metadata.height,
    placement: { trackId, from, durationInFrames },
  })
  const volumeDb = optionalNumber(op, 'volumeDb')
  const fadeOut = optionalNumber(op, 'fadeOutSeconds')
  addItem({
    ...item,
    ...(volumeDb === undefined ? {} : { volume: volumeDb }),
    ...(fadeOut === undefined ? {} : { audioFadeOut: Math.max(0, fadeOut) }),
  } as TimelineItem)
  // Placement may move an item off an overlap: answer where it actually went.
  const placed = useItemsStore.getState().itemById[item.id]
  return {
    id: item.id,
    trackId: placed?.trackId ?? trackId,
    from: placed?.from ?? from,
    durationInFrames: placed?.durationInFrames ?? durationInFrames,
  }
}

// ── the engine ───────────────────────────────────────────────────────────────

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
