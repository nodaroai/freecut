export interface ResolvePreviewCaptureFrameParams {
  currentFrame: number
  previewFrame: number | null
  isPlaying: boolean
  livePlaybackFrame?: number | null
}

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.max(0, Math.round(frame))
}

export function resolvePreviewCaptureFrame({
  currentFrame,
  previewFrame,
  isPlaying,
  livePlaybackFrame,
}: ResolvePreviewCaptureFrameParams): number {
  if (previewFrame !== null) {
    return normalizeFrame(previewFrame)
  }

  if (
    isPlaying &&
    livePlaybackFrame !== null &&
    livePlaybackFrame !== undefined &&
    Number.isFinite(livePlaybackFrame)
  ) {
    return normalizeFrame(livePlaybackFrame)
  }

  return normalizeFrame(currentFrame)
}
