import type { TimelineItem, VideoItem } from '@/types/timeline'

/** One piece of the original on the timeline: where it sits and which second of the file it starts at. */
export interface OriginalPiece {
  readonly from: number
  readonly durationInFrames: number
  readonly start: number
  readonly speed: number
}

export interface Original {
  readonly mediaId: string
  /** Every video clip of the original media, in timeline order. */
  readonly pieces: readonly OriginalPiece[]
}

const pieceEnd = (piece: OriginalPiece, fps: number) =>
  piece.start + (piece.durationInFrames / fps) * piece.speed

/** The media of the timeline's first video clip, and every clip of it. */
export function originalOf(items: readonly TimelineItem[], fps: number): Original | null {
  const videos = items
    .filter((item): item is VideoItem => item.type === 'video' && !!item.mediaId)
    .toSorted((a, b) => a.from - b.from)
  const mediaId = videos[0]?.mediaId
  if (!mediaId) return null
  const pieces = videos
    .filter((video) => video.mediaId === mediaId)
    .map((video) => ({
      from: video.from,
      durationInFrames: video.durationInFrames,
      start: (video.sourceStart ?? 0) / (video.sourceFps || fps),
      speed: video.speed ?? 1,
    }))
  return { mediaId, pieces }
}

/**
 * The second of the original that a timeline frame shows. A frame between
 * pieces maps to where the next piece starts.
 */
export function sourceSecondsAt(
  frame: number,
  pieces: readonly OriginalPiece[],
  fps: number,
): number {
  const at = pieces.find((p) => frame >= p.from && frame < p.from + p.durationInFrames)
  if (at) return at.start + ((frame - at.from) / fps) * at.speed
  const next = pieces.find((p) => p.from > frame)
  if (next) return next.start
  const last = pieces.at(-1)
  return last ? pieceEnd(last, fps) : 0
}

/**
 * The timeline frame that shows a second of the original, and whether the
 * edit kept that second. A second the edit cut maps to where the edit picks the
 * original up again (or to its last frame when it never does).
 */
export function timelineFrameAt(
  seconds: number,
  pieces: readonly OriginalPiece[],
  fps: number,
): { frame: number; kept: boolean } {
  const at = pieces.find((p) => seconds >= p.start && seconds < pieceEnd(p, fps))
  if (at) {
    const offset = Math.floor(((seconds - at.start) / at.speed) * fps)
    return { frame: at.from + Math.min(offset, at.durationInFrames - 1), kept: true }
  }
  const resumes = pieces.filter((p) => p.start > seconds).toSorted((a, b) => a.start - b.start)[0]
  if (resumes) return { frame: resumes.from, kept: false }
  const last = pieces.at(-1)
  return { frame: last ? last.from + last.durationInFrames - 1 : 0, kept: false }
}
