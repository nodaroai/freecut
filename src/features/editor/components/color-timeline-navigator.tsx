import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  createScrubThrottleState,
  shouldCommitScrubFrame,
} from '@/features/editor/deps/timeline-utils'
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

function resolveTimelineMaxFrame(items: readonly TimelineItem[]): number {
  const itemMax = items.reduce(
    (maxFrame, item) => Math.max(maxFrame, item.from + item.durationInFrames),
    0,
  )
  return Math.max(MIN_TIMELINE_FRAMES, itemMax)
}

function formatNavigatorTime(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const totalSeconds = Math.max(0, Math.floor(frame / safeFps))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function getDisplayFrame() {
  const playbackState = usePlaybackStore.getState()
  return playbackState.previewFrame ?? playbackState.currentFrame
}

const ColorTimelinePlayhead = memo(function ColorTimelinePlayhead({
  timelineMaxFrame,
}: {
  timelineMaxFrame: number
}) {
  const playheadRef = useRef<HTMLDivElement>(null)
  const maxFrameRef = useRef(timelineMaxFrame)
  maxFrameRef.current = timelineMaxFrame
  // Container width is cached so per-frame position updates stay layout-free
  // (getBoundingClientRect forces layout on every playback store change).
  const containerWidthRef = useRef(0)

  const updatePosition = useCallback((frame: number) => {
    const playhead = playheadRef.current
    if (!playhead) return

    if (containerWidthRef.current <= 0) {
      containerWidthRef.current = playhead.parentElement?.getBoundingClientRect().width ?? 0
    }
    const maxFrame = Math.max(MIN_TIMELINE_FRAMES, maxFrameRef.current, frame + 1)
    const ratio = maxFrame > 0 ? Math.max(0, Math.min(1, frame / maxFrame)) : 0
    playhead.style.transform = `translate3d(${Math.round(containerWidthRef.current * ratio)}px, 0, 0)`
  }, [])

  useEffect(() => {
    updatePosition(getDisplayFrame())

    const unsubscribe = usePlaybackStore.subscribe((state) => {
      updatePosition(state.previewFrame ?? state.currentFrame)
    })

    const container = playheadRef.current?.parentElement
    if (typeof ResizeObserver === 'undefined' || !container) return unsubscribe

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) containerWidthRef.current = width
      updatePosition(getDisplayFrame())
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      unsubscribe()
    }
  }, [updatePosition])

  useLayoutEffect(() => {
    updatePosition(getDisplayFrame())
  }, [timelineMaxFrame, updatePosition])

  return (
    <div
      ref={playheadRef}
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-0"
      aria-hidden="true"
    >
      <span className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.55)]" />
      <span className="absolute left-0 top-[26px] h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500 drop-shadow-[0_0_4px_rgba(239,68,68,0.6)]" />
    </div>
  )
})

export const ColorTimelineNavigator = memo(function ColorTimelineNavigator() {
  const { t } = useTranslation()
  const { items, tracks } = useItemsStore(
    useShallow((s) => ({
      items: s.items,
      tracks: s.tracks,
    })),
  )
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame)
  const fps = useTimelineStore((s) => s.fps)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectItems = useSelectionStore((s) => s.selectItems)
  const isScrubbingRef = useRef(false)
  // Scrub gesture state: rect is captured once on pointer down (no layout reads
  // per move), commits are rAF-batched and gated by the same adaptive throttle
  // the Edit-workspace playhead uses.
  const scrubRectRef = useRef<DOMRect | null>(null)
  const scrubThrottleRef = useRef(createScrubThrottleState())
  const pendingClientXRef = useRef<number | null>(null)
  const scrubRafRef = useRef<number | null>(null)

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
  const timelineMaxFrame = resolveTimelineMaxFrame(items)

  const clientXToFrame = useCallback(
    (clientX: number): number | null => {
      const rect = scrubRectRef.current
      if (!rect || rect.width <= 0) return null
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return Math.round(ratio * timelineMaxFrame)
    },
    [timelineMaxFrame],
  )

  const cancelScrubRaf = useCallback(() => {
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current)
      scrubRafRef.current = null
    }
    pendingClientXRef.current = null
  }, [])

  useEffect(() => cancelScrubRaf, [cancelScrubRaf])

  const handleScrubStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      isScrubbingRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      scrubRectRef.current = event.currentTarget.getBoundingClientRect()
      const frame = clientXToFrame(event.clientX)
      if (frame === null) return
      scrubThrottleRef.current = createScrubThrottleState({
        pointerX: event.clientX - scrubRectRef.current.left,
        frame,
        nowMs: performance.now(),
      })
      setScrubFrame(frame, null)
    },
    [clientXToFrame, setScrubFrame],
  )

  const handleScrubMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      pendingClientXRef.current = event.clientX
      if (scrubRafRef.current !== null) return
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null
        const clientX = pendingClientXRef.current
        const rect = scrubRectRef.current
        if (!isScrubbingRef.current || clientX === null || !rect) return
        const frame = clientXToFrame(clientX)
        if (frame === null) return
        const navigatorPixelsPerSecond = (rect.width * (fps > 0 ? fps : 30)) / timelineMaxFrame
        if (
          shouldCommitScrubFrame({
            state: scrubThrottleRef.current,
            pointerX: clientX - rect.left,
            targetFrame: frame,
            pixelsPerSecond: navigatorPixelsPerSecond,
            nowMs: performance.now(),
          })
        ) {
          setScrubFrame(frame, null)
        }
      })
    },
    [clientXToFrame, fps, setScrubFrame, timelineMaxFrame],
  )

  const finishScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      const frame = clientXToFrame(event.clientX)
      if (frame !== null) setScrubFrame(frame, null)
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [cancelScrubRaf, clientXToFrame, setScrubFrame, setPreviewFrame],
  )

  const cancelScrub = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbingRef.current) return
      cancelScrubRaf()
      isScrubbingRef.current = false
      scrubRectRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPreviewFrame(null)
    },
    [cancelScrubRaf, setPreviewFrame],
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
        {visualClips.filter((clip) => clip.trackId === track.id).map((clip) => renderClip(clip))}
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
          <ColorTimelinePlayhead timelineMaxFrame={timelineMaxFrame} />
        </div>
      </div>
    </section>
  )
})
