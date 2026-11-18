import { useEffect, useRef } from 'react'

const VARS = ['left', 'top', 'width', 'height'] as const

/**
 * The place in the scopes column the editor's own loudness meter is shown on.
 * The meter stays where the upstream editor renders it (beside the timeline);
 * the stylesheet only lays it over this slot, from the rect written here as
 * `--nodaro-meter-*` on the page, so no node the editor owns is moved.
 */
export function StudioMeterSlot() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    let frame = 0
    const report = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const rect = { left: r.left, top: r.top, width: r.width, height: r.height }
      for (const key of VARS) root.style.setProperty(`--nodaro-meter-${key}`, `${rect[key]}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    // The slot moves when any panel of its row changes size, not only when it does.
    const row = el.closest('[data-studio-host]')?.parentElement
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const child of Array.from(row?.children ?? [])) observer.observe(child)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
      for (const key of VARS) root.style.removeProperty(`--nodaro-meter-${key}`)
    }
  }, [])
  return <div ref={ref} className="nodaro-studio-meter-slot" aria-hidden="true" />
}
