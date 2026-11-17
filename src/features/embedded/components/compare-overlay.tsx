import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { resolveMediaUrl } from '../deps/media-library-contract'
import { useItemsStore, useTimelineSettingsStore } from '../deps/timeline-contract'
import { originalOf } from '../services/compare-mapping'
import { useCompareStore, type CompareMode } from '../stores/compare-store'
import { boxOf, type Box } from './presence-targets'
import { useOriginalPlayback } from './use-original-playback'

const PROGRAM_REGION = '[data-presence-target="preview"]'
const PROGRAM_PICTURE = '[data-player-container]'
const TIMELINE = '[data-timeline-scroll-container]'

/** The original media file's URL, once read. */
function useOriginalUrl(mediaId: string | undefined): string | null {
  const [url, setUrl] = useState<{ mediaId: string; url: string } | null>(null)
  useEffect(() => {
    if (!mediaId) return
    let live = true
    void resolveMediaUrl(mediaId).then((resolved) => {
      if (live && resolved) setUrl({ mediaId, url: resolved })
    })
    return () => {
      live = false
    }
  }, [mediaId])
  return url && url.mediaId === mediaId ? url.url : null
}

function place(el: HTMLElement | null, box: Box | null): void {
  if (!el) return
  el.style.display = box ? '' : 'none'
  if (!box) return
  el.style.transform = `translate(${box.left}px, ${box.top}px)`
  el.style.width = `${box.width}px`
  el.style.height = `${box.height}px`
}

interface Layers {
  stage: HTMLDivElement | null
  divider: HTMLDivElement | null
  note: HTMLDivElement | null
  control: HTMLDivElement | null
}

/** Places the layers over the program monitor and the timeline every frame, following resizes. */
function useLayerLayout(layers: RefObject<Layers>, mode: CompareMode, ready: boolean) {
  useEffect(() => {
    let frameId = 0
    const tick = () => {
      const { stage, divider, note, control } = layers.current
      const region = boxOf(document.querySelector(PROGRAM_REGION))
      const picture = boxOf(document.querySelector(PROGRAM_PICTURE))
      const split = useCompareStore.getState().split
      place(stage, !ready || mode === 'program' ? null : mode === 'source' ? region : picture)
      if (stage) stage.style.clipPath = mode === 'split' ? `inset(0 ${(1 - split) * 100}% 0 0)` : ''
      place(
        divider,
        mode === 'split' && picture && ready
          ? {
              left: picture.left + split * picture.width - 9,
              top: picture.top,
              width: 18,
              height: picture.height,
            }
          : null,
      )
      place(note, mode === 'source' ? boxOf(document.querySelector(TIMELINE)) : null)
      if (control) {
        control.style.display = region ? '' : 'none'
        if (region) {
          const width = control.offsetWidth
          control.style.transform = `translate(${region.left + (region.width - width) / 2}px, ${region.top + region.height - control.offsetHeight - 10}px)`
        }
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [layers, mode, ready])
}

/** Dragging the split divider moves it across the program picture. */
function dragDivider(event: ReactPointerEvent<HTMLDivElement>): void {
  const handle = event.currentTarget
  handle.setPointerCapture(event.pointerId)
  const moveTo = (clientX: number) => {
    const picture = boxOf(document.querySelector(PROGRAM_PICTURE))
    if (picture) useCompareStore.getState().setSplit((clientX - picture.left) / picture.width)
  }
  const onMove = (move: PointerEvent) => moveTo(move.clientX)
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
  moveTo(event.clientX)
}

const SEGMENTS: ReadonlyArray<{ mode: CompareMode; key: string; fallback: string }> = [
  { mode: 'source', key: 'embedded.compare.original', fallback: 'Original' },
  { mode: 'split', key: 'embedded.compare.split', fallback: 'Split' },
  { mode: 'program', key: 'embedded.compare.edited', fallback: 'Edited' },
]

const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, display: 'none' }

/**
 * The edit beside its original (NODARO_PLAYBACK `compare`), drawn over the
 * program monitor once the parent has asked for it: the original media of the
 * timeline's first video clip, alone ('source') or over the left part of the
 * edit up to a draggable divider ('split'), and an Original | Split | Edited
 * control under the picture. While the original shows alone, the timeline is
 * dimmed with a view-only note.
 */
export function CompareOverlay() {
  const { t } = useTranslation()
  const offered = useCompareStore((s) => s.offered)
  const mode = useCompareStore((s) => s.mode)
  const split = useCompareStore((s) => s.split)
  const items = useItemsStore((s) => s.items)
  const fps = useTimelineSettingsStore((s) => s.fps) || 30
  const original = useMemo(() => originalOf(items, fps), [items, fps])
  const url = useOriginalUrl(original?.mediaId)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const layers = useRef<Layers>({ stage: null, divider: null, note: null, control: null })

  useOriginalPlayback({ video, mode: url ? mode : 'program', pieces: original?.pieces ?? [], fps })
  useLayerLayout(layers, mode, !!url && !!original)

  if (!offered) return null
  return createPortal(
    <div
      data-embedded-compare
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147482000 }}
    >
      <div
        ref={(stage) => {
          layers.current.stage = stage
        }}
        style={{
          ...layer,
          overflow: 'hidden',
          background: mode === 'source' ? '#000' : 'transparent',
          // Alone, the original stands in for the edit: nothing under it can be touched.
          pointerEvents: mode === 'source' ? 'auto' : 'none',
        }}
      >
        <video
          ref={setVideo}
          src={url ?? undefined}
          playsInline
          preload="auto"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
      <div
        ref={(divider) => {
          layers.current.divider = divider
        }}
        role="slider"
        aria-label={t('embedded.compare.divider', { defaultValue: 'Split position' })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        onPointerDown={dragDivider}
        style={{ ...layer, pointerEvents: 'auto', cursor: 'ew-resize', touchAction: 'none' }}
      >
        <div
          style={{
            position: 'absolute',
            left: 8,
            top: 0,
            bottom: 0,
            width: 2,
            background: '#fff',
            boxShadow: '0 0 6px rgba(0,0,0,0.6)',
          }}
        />
      </div>
      <div
        ref={(note) => {
          layers.current.note = note
        }}
        style={{ ...layer, background: 'rgba(0,0,0,0.45)' }}
      >
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 10px',
            borderRadius: 4,
            background: 'rgba(20,20,20,0.85)',
            color: 'rgba(255,255,255,0.8)',
            font: '500 12px/1.2 "IBM Plex Sans", system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {t('embedded.compare.viewOnly', { defaultValue: 'Original · view only' })}
        </div>
      </div>
      <div
        ref={(control) => {
          layers.current.control = control
        }}
        role="group"
        aria-label={t('embedded.compare.label', { defaultValue: 'Compare with the original' })}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          display: 'flex',
          gap: 2,
          padding: 2,
          borderRadius: 6,
          background: 'rgba(20,20,20,0.85)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
          pointerEvents: 'auto',
        }}
      >
        {SEGMENTS.map((segment) => (
          <button
            key={segment.mode}
            type="button"
            aria-pressed={mode === segment.mode}
            onClick={() => useCompareStore.getState().setMode(segment.mode)}
            style={{
              border: 0,
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
              font: '500 12px/1.2 "IBM Plex Sans", system-ui, sans-serif',
              background: mode === segment.mode ? '#fff' : 'transparent',
              color: mode === segment.mode ? '#111' : 'rgba(255,255,255,0.8)',
            }}
          >
            {t(segment.key, { defaultValue: segment.fallback })}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
