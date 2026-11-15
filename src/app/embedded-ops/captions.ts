/**
 * `addTranscriptCaptions { mediaId, cues: [{ text, start, end, words? }],
 * stylePresetId?, highlight?: { color } }`: caption every clip of the media
 * from cues in media seconds (the same caption segments as Insert transcript
 * as captions).
 *
 * With `highlight` and a cue's `words` ([{ text, start, end }], media seconds),
 * that caption becomes one cue per spoken word, the word wrapped in
 * `<font color>`, so the word being said lights up in place. Without
 * `highlight`, `words` are ignored and the captions are as before.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import {
  buildCaptionTrackAbove,
  buildSubtitleSegmentForClip,
  findCompatibleCaptionTrackForRanges,
  getCaptionRangeForClip,
  getCaptionStyleTemplateFromPreset,
} from '@/features/media-library/utils/caption-items'
import { useSettingsStore } from '@/features/settings/stores/settings-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { addItems, setTracks } from '@/features/timeline/stores/timeline-actions'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { wordHighlightCues, type CaptionWord } from './caption-words'
import { fail, isHexColor, requireString } from './op-fields'
import { clipsOf, projectCanvas, timelineFps } from './timeline-context'

interface CaptionCue {
  text: string
  start: number
  end: number
  words?: CaptionWord[]
}

function readWords(op: EditOp, value: unknown, cue: CaptionCue, index: number) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) fail(op, `cues[${index}].words must be a list of { text, start, end }`)
  return value.map((entry, wordIndex): CaptionWord => {
    const path = `cues[${index}].words[${wordIndex}]`
    const { text, start, end } = (entry ?? {}) as { text?: unknown; start?: unknown; end?: unknown }
    if (typeof text !== 'string' || text.trim().length === 0) fail(op, `${path} needs text`)
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start < 0) {
      fail(op, `${path} needs a start and a later end, in seconds`)
    }
    if (end <= cue.start || start >= cue.end) fail(op, `${path} is outside its cue`)
    return { text: text.trim(), start, end }
  })
}

function requireCues(op: EditOp): CaptionCue[] {
  const value = op.cues
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${op.op} requires \`cues\`, a list of { text, start, end } in seconds`)
  }
  return value.map((entry, index) => {
    const { text, start, end, words } = (entry ?? {}) as Record<string, unknown>
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(`${op.op}: cues[${index}] needs text`)
    }
    if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start < 0) {
      throw new Error(`${op.op}: cues[${index}] needs a start and a later end, in seconds`)
    }
    const cue = { text: text.trim(), start, end }
    const read = readWords(op, words, cue, index)
    return read ? { ...cue, words: read } : cue
  })
}

/** The highlight color, when the captions light up the spoken word. */
function readHighlight(op: EditOp): string | undefined {
  if (op.highlight === undefined) return undefined
  const color = (op.highlight as { color?: unknown } | null)?.color
  if (!isHexColor(color)) fail(op, '`highlight.color` must be a hex color such as #FFD400')
  return color
}

/** The segment cues, in media seconds: one per caption, or one per word when highlighting. */
function subtitleCuesFor(mediaId: string, cues: readonly CaptionCue[], highlight?: string) {
  return cues.flatMap((cue, index) => {
    const id = `caption-${mediaId}-${index}`
    if (!highlight || !cue.words) {
      return [{ id, startSeconds: cue.start, endSeconds: cue.end, text: cue.text }]
    }
    return wordHighlightCues(cue, cue.words, highlight).map((part, partIndex) => ({
      id: `${id}-${partIndex}`,
      startSeconds: part.start,
      endSeconds: part.end,
      text: part.text,
    }))
  })
}

export function applyAddTranscriptCaptions(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const cues = requireCues(op)
  const highlight = readHighlight(op)
  const metadata = projectCanvas()
  const clips = clipsOf(mediaId)
  // Caption the picture; an audio-only media file is captioned on its audio clips.
  const targets = clips.some((clip) => clip.type === 'video')
    ? clips.filter((clip) => clip.type === 'video')
    : clips
  const fps = timelineFps()
  const presetId =
    typeof op.stylePresetId === 'string'
      ? op.stylePresetId
      : useSettingsStore.getState().defaultCaptionStylePresetId
  const styleTemplate = getCaptionStyleTemplateFromPreset(presetId, metadata.width, metadata.height)
  const segments = cues.map(({ text, start, end }) => ({ text, start, end }))
  const subtitleCues = subtitleCuesFor(mediaId, cues, highlight)

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
