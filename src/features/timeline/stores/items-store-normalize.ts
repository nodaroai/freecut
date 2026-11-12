import type { ShapeItem, SubtitleSegmentItem, TimelineItem, TimelineTrack } from '@/types/timeline'
import type { MaskVertex } from '@/types/masks'
import { normalizeAudioEqSettings } from '@/shared/utils/audio-eq'
import { resolveCornerPinTargetRect } from '@/features/timeline/deps/composition-runtime'
import {
  applyOptionalClamps,
  roundDuration,
  roundFrame,
  roundOptionalFrame,
  normalizeOptionalFps,
} from '@/shared/timeline/item-clamps'

export { roundFrame, roundDuration, roundOptionalFrame, normalizeOptionalFps }

const MIN_ENABLED_STROKE_WIDTH = 1

function clampShapePercent(value: number | undefined, max = 100): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(max, value))
}

function resolveCornerPinReferenceDimension(
  existing: number | undefined,
  measured: number,
): number | undefined {
  if (existing !== undefined) return existing
  return measured > 0 ? measured : undefined
}

function normalizeCornerPinReference(item: TimelineItem): void {
  if (!item.cornerPin) return
  const targetRect = resolveCornerPinTargetRect(
    item.transform?.width ?? 0,
    item.transform?.height ?? 0,
    item.type === 'video' || item.type === 'image'
      ? {
          sourceWidth: item.sourceWidth,
          sourceHeight: item.sourceHeight,
          crop: item.crop,
        }
      : undefined,
  )
  item.cornerPin = {
    ...item.cornerPin,
    referenceWidth: resolveCornerPinReferenceDimension(
      item.cornerPin.referenceWidth,
      targetRect.width,
    ),
    referenceHeight: resolveCornerPinReferenceDimension(
      item.cornerPin.referenceHeight,
      targetRect.height,
    ),
  }
}

function resolvePathTangentMode(vertex: MaskVertex): MaskVertex['tangentMode'] {
  if (vertex.tangentMode) return vertex.tangentMode
  const hasNoHandles =
    vertex.inHandle[0] === 0 &&
    vertex.inHandle[1] === 0 &&
    vertex.outHandle[0] === 0 &&
    vertex.outHandle[1] === 0
  return hasNoHandles ? 'corner' : 'smooth'
}

function applyPathStrokeDefaults(item: ShapeItem): void {
  item.strokeEnabled ??= true
  item.strokeLineCap ??= 'butt'
  item.strokeLineJoin ??= 'miter'
  item.strokeMiterLimit ??= 4
}

function normalizePathShapeFields(item: ShapeItem): void {
  if (item.shapeType !== 'path') return
  item.pathClosed = item.isMask ? true : (item.pathClosed ?? true)
  if (item.pathClosed === false) item.fillEnabled = false
  else item.fillEnabled ??= true
  applyPathStrokeDefaults(item)
  item.pathVertices = item.pathVertices?.map((vertex) => ({
    ...vertex,
    tangentMode: resolvePathTangentMode(vertex),
  }))
}

function normalizeShapeFields(item: ShapeItem): void {
  item.taperStartWidth = clampShapePercent(item.taperStartWidth, 200)
  item.taperEndWidth = clampShapePercent(item.taperEndWidth, 200)
  item.taperStartLength = clampShapePercent(item.taperStartLength)
  item.taperEndLength = clampShapePercent(item.taperEndLength)
  normalizePathShapeFields(item)
  if (item.strokeEnabled === true && (item.strokeWidth ?? 0) < MIN_ENABLED_STROKE_WIDTH) {
    item.strokeWidth = MIN_ENABLED_STROKE_WIDTH
  }
  if (item.isMask) item.blendMode = 'normal'
}

function normalizeLegacySourceStart(item: TimelineItem): void {
  if (
    (item.type === 'video' || item.type === 'audio') &&
    item.sourceEnd !== undefined &&
    item.sourceStart === undefined
  ) {
    item.sourceStart = 0
  }
}

export function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  // Start from a shallow copy so the optional-clamp loop can rewrite fields
  // in place without mutating the caller's object.
  const normalized = { ...item } as Record<string, unknown>
  normalized.from = roundFrame(item.from)
  normalized.durationInFrames = roundDuration(item.durationInFrames)
  applyOptionalClamps(normalized)

  const result = normalized as TimelineItem
  normalizeCornerPinReference(result)
  if (result.type === 'shape') normalizeShapeFields(result)
  normalizeLegacySourceStart(result)
  return result as T
}

export function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Record<string, unknown>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from as number)
  if (normalized.durationInFrames !== undefined) {
    normalized.durationInFrames = roundDuration(normalized.durationInFrames as number)
  }

  applyOptionalClamps(normalized)

  if (
    normalized.strokeEnabled === true &&
    typeof normalized.strokeWidth === 'number' &&
    normalized.strokeWidth < MIN_ENABLED_STROKE_WIDTH
  ) {
    normalized.strokeWidth = MIN_ENABLED_STROKE_WIDTH
  }

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined && normalized.sourceStart === undefined) {
    normalized.sourceStart = 0
  }

  return normalized as Partial<TimelineItem>
}

export function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    volume: track.volume === undefined ? undefined : Math.max(-60, Math.min(12, track.volume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
  }
}

/**
 * Trim a subtitle segment from its start: re-anchor every cue's time so the
 * new `from` becomes 0, dropping cues entirely before the new boundary and
 * clamping cues that straddle it.
 *
 * `clampedAmount` is in timeline frames — positive means trimming inward.
 */
export function trimSubtitleCuesAtStart(
  item: SubtitleSegmentItem,
  clampedAmount: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  if (clampedAmount === 0) return null
  const offsetSeconds = clampedAmount / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.endSeconds <= offsetSeconds) continue // entirely outside new window
    const startSeconds = Math.max(0, cue.startSeconds - offsetSeconds)
    const endSeconds = cue.endSeconds - offsetSeconds
    if (endSeconds <= startSeconds) continue
    nextCues.push({ ...cue, startSeconds, endSeconds })
  }
  return { cues: nextCues }
}

/**
 * Trim a subtitle segment from its end: drop cues past the new duration and
 * clamp cues that straddle the boundary.
 */
export function trimSubtitleCuesAtEnd(
  item: SubtitleSegmentItem,
  newDurationFrames: number,
  timelineFps: number,
): { cues: SubtitleSegmentItem['cues'] } | null {
  const newEndSeconds = newDurationFrames / timelineFps
  const nextCues: SubtitleSegmentItem['cues'] = []
  for (const cue of item.cues) {
    if (cue.startSeconds >= newEndSeconds) continue
    const endSeconds = Math.min(cue.endSeconds, newEndSeconds)
    if (endSeconds <= cue.startSeconds) continue
    nextCues.push({ ...cue, endSeconds })
  }
  return { cues: nextCues }
}
