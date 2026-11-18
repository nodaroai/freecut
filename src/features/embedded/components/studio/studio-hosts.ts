import { useEffect, useMemo } from 'react'

/**
 * Where the studio layout puts its own panels inside the editor the upstream
 * code draws, found by what that code already renders (roles and the
 * `data-editor-pane` marks) rather than by changing it:
 * - `brand`: first in the top bar; `crew`: in the top bar before its buttons.
 * - `monitor`, `scopes`, `side`: in the row that holds the program monitor.
 * - `timecode`: first in the timeline's own toolbar.
 * - `status`: last in the editor, under the timeline.
 * - `effects`: under the media panel, in its column.
 * Each is a plain element we own; React portals render into it. When the
 * editor redraws a part, the element is put back.
 */
export type StudioHostName =
  | 'brand'
  | 'crew'
  | 'monitor'
  | 'scopes'
  | 'side'
  | 'timecode'
  | 'status'
  | 'effects'

const NAMES: readonly StudioHostName[] = [
  'brand',
  'crew',
  'monitor',
  'scopes',
  'side',
  'timecode',
  'status',
  'effects',
]

function ownChildren(parent: Element): Element[] {
  return [...parent.children].filter((child) => !(child as HTMLElement).dataset.studioHost)
}

/** Put `host` into `parent` before `before` (or last), unless it is already in `parent`. */
function place(
  host: HTMLElement,
  parent: Element | null | undefined,
  before: Element | null = null,
) {
  if (!parent) {
    host.remove()
    return
  }
  if (host.parentElement === parent) return
  parent.insertBefore(host, before && before.parentElement === parent ? before : null)
}

/** Find each host's place in the editor now and put it there. */
export function placeHosts(
  hosts: Readonly<Record<StudioHostName, HTMLElement>>,
  root: ParentNode = document,
) {
  const app = root.querySelector('[role="application"]')
  const toolbar = app?.querySelector('[role="toolbar"]')
  const toolbarOwn = toolbar ? ownChildren(toolbar) : []
  place(hosts.brand, toolbar, toolbarOwn[0] ?? null)
  place(hosts.crew, toolbar, toolbarOwn[toolbarOwn.length - 1] ?? null)

  const preview = root.querySelector('[data-editor-pane="preview"]')
  const row = preview?.parentElement
  place(hosts.monitor, row, preview ?? null)
  place(hosts.scopes, row, preview?.nextElementSibling ?? null)
  place(hosts.side, row, null)

  const timeline = root.querySelector('[data-editor-pane="timeline"]')
  const timelineBar = timeline?.firstElementChild
  place(hosts.timecode, timelineBar, timelineBar ? (ownChildren(timelineBar)[1] ?? null) : null)

  place(hosts.status, app, null)

  const media = root.querySelector('[data-editor-pane="media"]')
  place(hosts.effects, media?.parentElement, null)
}

/** The studio's host elements, kept in place while the editor changes. */
export function useStudioHosts(): Readonly<Record<StudioHostName, HTMLElement>> {
  const hosts = useMemo(() => {
    const made = {} as Record<StudioHostName, HTMLElement>
    for (const name of NAMES) {
      const el = document.createElement('div')
      el.dataset.studioHost = name
      made[name] = el
    }
    return made
  }, [])

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        placeHosts(hosts)
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    placeHosts(hosts)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      for (const name of NAMES) hosts[name].remove()
    }
  }, [hosts])

  return hosts
}
