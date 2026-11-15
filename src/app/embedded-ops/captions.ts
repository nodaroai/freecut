/**
 * `addTranscriptCaptions { mediaId, cues: [{ text, start, end }], stylePresetId? }`:
 * caption every clip of the media from cues in media seconds (the same caption
 * segments as Insert transcript as captions).
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
import { requireString } from './op-fields'
import { clipsOf, projectCanvas, timelineFps } from './timeline-context'

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

export function applyAddTranscriptCaptions(op: EditOp): unknown {
  const mediaId = requireString(op, 'mediaId')
  const cues = requireCues(op)
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
