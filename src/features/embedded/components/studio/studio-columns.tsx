import { Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import {
  ColorScopesView,
  SourceMonitor,
  useEditorStore,
  useMediaLibraryStore,
} from '../../deps/studio-contract'
import { useStudioStore } from '../../stores/studio-store'
import { postToParent } from '../../services/studio-message'
import { useActivityLog } from './activity-log'
import { StudioMeterSlot } from './meter-slot'
import { studioWord } from './studio-strings'

function clock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/** The source being looked at: the one opened, else the first video in Media. */
function useSourceId(): string | null {
  const opened = useEditorStore((s) => s.sourcePreviewMediaId)
  const firstVideo = useMediaLibraryStore(
    (s) => s.mediaItems.find((m) => m.mimeType.startsWith('video/'))?.id ?? null,
  )
  return opened ?? firstVideo
}

function ActivityLog() {
  const entries = useActivityLog((s) => s.entries)
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries])
  return (
    <section className="nodaro-studio-panel nodaro-studio-activity">
      <header className="nodaro-studio-panel-head">
        <span>{studioWord('activity')}</span>
        {entries.length > 0 && <span className="nodaro-studio-panel-note">{entries.length}</span>}
      </header>
      <div ref={listRef} className="nodaro-studio-activity-list">
        {entries.length === 0 ? (
          <p className="nodaro-studio-empty">{studioWord('noActivity')}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.key} className="nodaro-studio-activity-line">
              <span className="nodaro-studio-activity-time">{clock(entry.at)}</span>
              <span className="nodaro-studio-activity-agent" style={{ color: entry.color }}>
                {entry.agent}
              </span>
              <span className="nodaro-studio-activity-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** The source monitor over the agents' activity, left of the program. */
export function StudioMonitorColumn() {
  const sourceId = useSourceId()
  return (
    <div className="nodaro-studio-column nodaro-studio-monitor">
      <section className="nodaro-studio-panel nodaro-studio-source">
        {sourceId ? (
          <Suspense fallback={null}>
            <SourceMonitor key={sourceId} mediaId={sourceId} />
          </Suspense>
        ) : (
          <>
            <header className="nodaro-studio-panel-head">
              <span>{studioWord('source')}</span>
            </header>
            <p className="nodaro-studio-empty">{studioWord('noSource')}</p>
          </>
        )}
      </section>
      <ActivityLog />
    </div>
  )
}

/** Waveform and vectorscope of the program, right of it. */
export function StudioScopesColumn() {
  return (
    <div className="nodaro-studio-column nodaro-studio-scopes">
      <ColorScopesView open />
      <StudioMeterSlot />
    </div>
  )
}

/**
 * The room kept for the parent's side panel, as wide as it asked while it is
 * open; its rect goes to the parent so its panel sits exactly on it.
 */
export function StudioSideSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const sideOpen = useStudioStore((s) => s.sideOpen)
  const sideWidth = useStudioStore((s) => s.sideWidth)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const report = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      postToParent('FREECUT_STUDIO_SLOT', {
        open: sideOpen && r.width > 0,
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [sideOpen, sideWidth])
  return (
    <div
      ref={ref}
      className="nodaro-studio-side"
      style={{ width: sideOpen ? sideWidth : 0 }}
      aria-hidden="true"
    />
  )
}
