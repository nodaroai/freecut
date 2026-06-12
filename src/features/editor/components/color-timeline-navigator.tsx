import { memo, useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'

interface TimelineClip {
  id: string
  label: string
  trackId: string
  from: number
  durationInFrames: number
  thumbnailUrl?: string
}

const STRIP_HEIGHT = 128
const TRACK_LANE_HEIGHT = 24
const MIN_TIMELINE_FRAMES = 300

function isVisualNavigatorItem(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'subtitle'
}

function getNavigatorLabel(item: TimelineItem): string {
  const label = item.label.trim()
  if (label) return label
  return item.type === 'adjustment' ? 'Grade' : item.type
}

function getThumbnailUrl(item: TimelineItem): string | undefined {
  return 'thumbnailUrl' in item ? item.thumbnailUrl : undefined
}

function resolveTimelineMaxFrame(items: readonly TimelineItem[], currentFrame: number): number {
  const itemMax = items.reduce(
    (maxFrame, item) => Math.max(maxFrame, item.from + item.durationInFrames),
    0,
  )
  return Math.max(MIN_TIMELINE_FRAMES, itemMax, currentFrame + 1)
}

function formatNavigatorTime(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, Math.floor(frame / safeFps))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export const ColorTimelineNavigator = memo(function ColorTimelineNavigator() {
  const { t } = useTranslation()
  const { items, tracks } = useItemsStore(
    useShallow((s) => ({
      items: s.items,
      tracks: s.tracks,
    })),
  )
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const fps = useTimelineStore((s) => s.fps)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const isScrubbingRef = useRef(false)

  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const visualClips = useMemo<TimelineClip[]>(
    () =>
      items
        .filter(isVisualNavigatorItem)
        .map((item) => ({
          id: item.id,
          label: getNavigatorLabel(item),
          trackId: item.trackId,
          from: item.from,
          durationInFrames: item.durationInFrames,
          thumbnailUrl: getThumbnailUrl(item),
        }))
        .sort((a, b) => a.from - b.from || a.trackId.localeCompare(b.trackId)),
    [items],
  )
  const videoTracks = useMemo<TimelineTrack[]>(
    () =>
      tracks
        .filter((track) => track.kind !== 'audio')
        .slice()
        .sort((a, b) => b.order - a.order),
    [tracks],
  )
  const audioTracks = useMemo<TimelineTrack[]>(
    () =>
      tracks
        .filter((track) => track.kind === 'audio')
        .slice()
        .sort((a, b) => b.order - a.order),
    [tracks],
  )
  const timelineMaxFrame = resolveTimelineMaxFrame(items, currentFrame)
  const playheadPercent = Math.max(0, Math.min(100, (currentFrame / timelineMaxFrame) * 100))

  const scrubToClientX = useCallback(
    (element: HTMLDivElement, clientX: number) => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      setScrubFrame(Math.round(ratio * timelineMaxFrame), null)
    },
    [setScrubFrame, timelineMaxFrame],
  )

  const handleScrubStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      isScrubbingRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrubToClientX(event.currentTarget, event.clientX)
    },
    [scrubToClientX],
  )

  const handleScrubMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      scrubToClientX(event.currentTarget, event.clientX)
    },
    [scrubToClientX],
  )

  const finishScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      scrubToClientX(event.currentTarget, event.clientX)
      isScrubbingRef.current = false
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [scrubToClientX, setPreviewFrame],
  )

  const cancelScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      isScrubbingRef.current = false
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [setPreviewFrame],
  )

  const seekToClip = useCallback(
    (clip: TimelineClip) => {
      selectItems([clip.id])
      setCurrentFrame(clip.from)
      setPreviewFrame(null)
    },
    [selectItems, setCurrentFrame, setPreviewFrame],
  )

  const renderClip = (clip: TimelineClip, compact = false) => {
    const selected = selectedItemIdSet.has(clip.id)
    return (
      <button
        key={`${clip.id}-${compact ? 'strip' : 'lane'}`}
        type="button"
        className={`absolute overflow-hidden rounded-[3px] border text-left transition-colors ${
          selected
            ? 'border-red-500 bg-red-500/10 shadow-[0_0_0_1px_rgba(239,68,68,0.55)]'
            : 'border-sky-500/70 bg-sky-500/35 hover:border-sky-300'
        }`}
        style={{
          left: `${(clip.from / timelineMaxFrame) * 100}%`,
          width: `${Math.max(0.6, (clip.durationInFrames / timelineMaxFrame) * 100)}%`,
          top: compact ? 0 : 4,
          height: compact ? 64 : 14,
        }}
        onClick={(event) => {
          event.stopPropagation()
          seekToClip(clip)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title={clip.label}
      >
        {compact && (
          <>
            {clip.thumbnailUrl ? (
              <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-black" />
            )}
            <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 py-0.5 text-[10px] text-white">
              {clip.label}
            </span>
          </>
        )}
      </button>
    )
  }

  const renderTrackRows = (rows: TimelineTrack[], prefix: string) =>
    rows.map((track, index) => (
      <div
        key={track.id}
        className="relative border-t border-border/70"
        style={{ height: TRACK_LANE_HEIGHT }}
      >
        <span className="absolute left-1 top-1 text-[10px] font-semibold text-muted-foreground">
          {track.name || `${prefix}${index + 1}`}
        </span>
        {visualClips
          .filter((clip) => clip.trackId === track.id)
          .map((clip) => renderClip(clip))}
      </div>
    ))

  return (
    <section
      className="panel-bg h-32 shrink-0 overflow-hidden border-y border-border"
      aria-label={t('editor.colorTimeline.label')}
      data-testid="color-timeline-navigator"
      style={{ height: STRIP_HEIGHT }}
    >
      <div className="flex h-full">
        <div className="w-36 shrink-0 border-r border-border px-1.5 py-1">
          <div className="relative h-[72px]">
            {visualClips.slice(0, 4).map((clip, index) => (
              <button
                key={clip.id}
                type="button"
                className={`absolute top-0 overflow-hidden rounded-[3px] border ${
                  selectedItemIdSet.has(clip.id) ? 'border-red-500' : 'border-border'
                } bg-black`}
                style={{ left: index * 34, width: 32, height: 56 }}
                onClick={() => {
                  seekToClip(clip)
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={clip.label}
              >
                {clip.thumbnailUrl && (
                  <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                )}
              </button>
            ))}
          </div>
          <div className="truncate text-[10px] font-medium text-muted-foreground">
            {visualClips.find((clip) => selectedItemIdSet.has(clip.id))?.label ??
              t('editor.colorTimeline.noClip')}
          </div>
        </div>

        <div
          className="relative min-w-0 flex-1 cursor-ew-resize"
          data-testid="color-timeline-scrub-surface"
          onPointerDown={handleScrubStart}
          onPointerMove={handleScrubMove}
          onPointerUp={finishScrub}
          onPointerCancel={cancelScrub}
        >
          <div className="relative h-7 border-b border-border/70">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <div
                key={ratio}
                className="absolute top-0 h-full border-l border-border/80 pl-1 text-[10px] text-muted-foreground"
                style={{ left: `${ratio * 100}%` }}
              >
                {formatNavigatorTime(Math.round(ratio * timelineMaxFrame), fps)}
              </div>
            ))}
          </div>
          <div className="relative">
            {renderTrackRows(videoTracks, 'V')}
            {renderTrackRows(audioTracks, 'A')}
          </div>
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-500"
            style={{ left: `${playheadPercent}%` }}
          >
            <span className="absolute -left-1.5 top-7 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
          </div>
        </div>
      </div>
    </section>
  )
})
