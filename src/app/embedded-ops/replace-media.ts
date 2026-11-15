/**
 * `replaceMedia { fromMediaId, toMediaId | toRef }`: put another media file
 * under every clip of one (its video and its audio), keeping each clip where
 * it is: the same start, length and source range. A file shorter than the
 * ranges the clips use is refused. Answers the ids of the clips it changed.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { updateItem } from '@/features/timeline/stores/timeline-actions'
import { getItemSourceSpanSeconds } from '@/features/timeline/utils/media-item-frames'
import { computeInitialTransform } from '@/features/timeline/utils/transform-init'
import { sourceFieldsFor } from '@/headless/edit-op-support'
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem } from '@/types/timeline'
import {
  mediaIdOf,
  prepareMedia,
  preparedData,
  readMediaMetadata,
  type PreparedMedia,
} from './media-prep'
import { fail, requireString } from './op-fields'
import { clipsOf, projectCanvas, timelineFps, type MediaClip } from './timeline-context'

/** How far past a file's end a clip's range may reach (rounding). */
const END_TOLERANCE_SECONDS = 0.05

interface PreparedSwap {
  readonly from: MediaMetadata
  readonly to: PreparedMedia
}

const prepared = preparedData<PreparedSwap>('replaceMedia')

export async function prepareReplaceMedia(op: EditOp): Promise<EditOp> {
  const fromMediaId = requireString(op, 'fromMediaId')
  const toMediaId = await mediaIdOf(op, op, { id: 'toMediaId', ref: 'toRef', path: '' })
  if (toMediaId === fromMediaId) fail(op, 'the new media is the media the clips already use')
  const from = await readMediaMetadata(fromMediaId)
  const to = await prepareMedia(op, toMediaId)
  return prepared.attach(op, { from, to })
}

function hasSound(media: PreparedMedia): boolean {
  return media.kind === 'audio' || (media.kind === 'video' && !!media.media.audioCodec)
}

/** Refuse a file that cannot stand in for the clips: no picture, no sound, or too short. */
function checkFits(op: EditOp, clips: readonly MediaClip[], to: PreparedMedia, fps: number) {
  if (clips.some((clip) => clip.type === 'video') && to.kind !== 'video') {
    fail(op, `${to.media.fileName} has no picture for the video clips`)
  }
  if (clips.some((clip) => clip.type === 'audio') && !hasSound(to)) {
    fail(op, `${to.media.fileName} has no sound for the audio clips`)
  }
  const usedEnd = clips.reduce(
    (end, clip) => Math.max(end, getItemSourceSpanSeconds(clip, fps)?.end ?? 0),
    0,
  )
  if (to.media.duration + END_TOLERANCE_SECONDS < usedEnd) {
    fail(
      op,
      `${to.media.fileName} is ${to.media.duration.toFixed(2)} s long, shorter than the ${usedEnd.toFixed(2)} s the clips use`,
    )
  }
}

/** A transform that is still the default fit of the old file is refitted to the new one. */
function refittedTransform(clip: MediaClip, from: MediaMetadata, to: MediaMetadata) {
  if (clip.type !== 'video' || !clip.transform || !to.width || !to.height) return {}
  const canvas = projectCanvas()
  const oldFit = computeInitialTransform(
    from.width || canvas.width,
    from.height || canvas.height,
    canvas.width,
    canvas.height,
  )
  const { width, height } = clip.transform
  const isDefaultFit =
    width !== undefined &&
    height !== undefined &&
    Math.abs(width - (oldFit.width ?? 0)) <= 1 &&
    Math.abs(height - (oldFit.height ?? 0)) <= 1
  if (!isDefaultFit) return {}
  const newFit = computeInitialTransform(to.width, to.height, canvas.width, canvas.height)
  return { transform: { ...clip.transform, width: newFit.width, height: newFit.height } }
}

function swapUpdates(clip: MediaClip, swap: PreparedSwap, fps: number): Partial<TimelineItem> {
  const { from, to } = swap
  const span = getItemSourceSpanSeconds(clip, fps) ?? { start: 0, end: 0 }
  const { sourceFps, sourceDuration } = sourceFieldsFor(to.media, fps)
  const sourceStart = Math.max(0, Math.round(span.start * sourceFps))
  const sourceEnd = Math.min(
    sourceDuration,
    Math.max(sourceStart + 1, Math.round(span.end * sourceFps)),
  )
  const common = {
    mediaId: to.media.id,
    src: to.blobUrl,
    sourceFps,
    sourceStart,
    sourceEnd,
    sourceDuration,
    ...(clip.label === from.fileName ? { label: to.media.fileName } : {}),
  }
  if (clip.type === 'audio') return { ...common, waveformData: undefined }
  return {
    ...common,
    audioSrc: undefined,
    thumbnailUrl: undefined,
    ...(to.media.width ? { sourceWidth: to.media.width } : {}),
    ...(to.media.height ? { sourceHeight: to.media.height } : {}),
    ...refittedTransform(clip, from, to.media),
  } as Partial<TimelineItem>
}

export function applyReplaceMedia(op: EditOp): unknown {
  const swap = prepared.read(op)
  const fps = timelineFps()
  const clips = clipsOf(swap.from.id)
  checkFits(op, clips, swap.to, fps)
  for (const clip of clips) updateItem(clip.id, swapUpdates(clip, swap, fps))
  return { ids: clips.map((clip) => clip.id) }
}
