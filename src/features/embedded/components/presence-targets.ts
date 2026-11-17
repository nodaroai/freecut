/**
 * Named parts of the editor a collaborator's cursor can point at
 * (NODARO_PRESENCE `target`). A name resolves, in order, to:
 * 1. an element marked `data-presence-target="<name>"`: tool.razor,
 *    tool.select, rail.<tab> (rail.text, rail.media, ...), panel.media,
 *    panel.properties, prop.gain, prop.position, prop.size, prop.canvas,
 *    prop.warmth, workspace.<id> (workspace.color, ...), tabs.sequences,
 *    tabs.new, timeline.ruler, transport.play and preview;
 * 2. a thing by its id: `media.item:<mediaId>` (a file in the Media panel),
 *    `timeline.track:<trackId>` and `timeline.item:<itemId>`;
 * 3. a few stable parts the editor already marks: timeline.playhead,
 *    panel.clip and preview.canvas;
 * 4. a lane: `lane.<kind of clip>` (lane.text, lane.subtitle, lane.image, lane.video,
 *    lane.audio, lane.adjustment) is the header of the first track that holds
 *    that kind of clip, else the first track on the same side (sound or
 *    picture), so an agent always has a home on the timeline.
 * Only an element that is on screen counts: a name whose element is hidden
 * (a closed panel, another tab) does not resolve, and its cursor is hidden.
 */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`

export function boxOf(el: Element | null | undefined): Box | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
    ? { left: r.left, top: r.top, width: r.width, height: r.height }
    : null
}

const TIMELINE = '[data-timeline-scroll-container]'

/** Prefixes naming a thing by its id, and where that thing is drawn. */
const BY_ID: ReadonlyArray<[prefix: string, selector: (id: string) => string]> = [
  ['media.item:', (id) => attr('data-media-id', id)],
  ['timeline.track:', (id) => `${TIMELINE} ${attr('data-track-id', id)}`],
  ['timeline.item:', (id) => `${TIMELINE} ${attr('data-item-id', id)}`],
]

/** Parts of the editor that already carry a stable mark of their own. */
const KNOWN: Readonly<Record<string, string>> = {
  'timeline.playhead': '[data-timeline-playhead]',
  'panel.clip': '[data-testid="properties-clip-panel-host"]',
  'preview.canvas': '[data-player-container]',
}

function selectorFor(name: string): string | null {
  for (const [prefix, selector] of BY_ID) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return selector(name.slice(prefix.length))
    }
  }
  return Object.hasOwn(KNOWN, name) ? KNOWN[name]! : null
}

function firstVisible(selector: string): Box | null {
  for (const el of document.querySelectorAll(selector)) {
    const box = boxOf(el)
    if (box) return box
  }
  return null
}

const LANE = 'lane.'

/** The header of the track an agent of this kind of clip calls home. */
function laneBox(kind: string): Box | null {
  const headers = [...document.querySelectorAll('[data-track-kind]')]
  const item = document.querySelector(
    `${TIMELINE} [data-timeline-item]${attr('data-item-type', kind)}`,
  )
  const trackId = item?.closest('[data-track-id]')?.getAttribute('data-track-id')
  const own = trackId ? headers.find((h) => h.getAttribute('data-track-id') === trackId) : null
  const side = kind === 'audio' ? 'audio' : 'video'
  const sameSide = headers.filter((h) => h.getAttribute('data-track-kind') === side)
  // Only a header the track list shows: one scrolled out of it is no home.
  const list = boxOf(document.querySelector(TIMELINE))
  const shown = (box: Box) =>
    !list ||
    Math.min(box.top + box.height, list.top + list.height) - Math.max(box.top, list.top) >= 30
  for (const header of [own, ...sameSide, ...headers]) {
    const box = boxOf(header)
    if (box && shown(box)) return box
  }
  return null
}

/** Where a named target is on screen now, or null when it is not showing. */
export function targetBox(name: string): Box | null {
  if (name.startsWith(LANE)) return laneBox(name.slice(LANE.length))
  const marked = firstVisible(attr('data-presence-target', name))
  if (marked) return marked
  const selector = selectorFor(name)
  return selector ? firstVisible(selector) : null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * The point a cursor rests on for a target: the middle of its visible part.
 * A timeline item is pointed at near its start, as an item cursor is.
 */
export function targetPoint(name: string, box: Box): { x: number; y: number } {
  if (name.startsWith(LANE)) {
    // Its home: the right part of the track's header, clear of the track's name.
    return {
      x: box.left + box.width - 46,
      y: box.top + Math.max(2, box.height / 2 - 18),
    }
  }
  const isItem = name.startsWith('timeline.item:')
  const lane =
    isItem || name.startsWith('timeline.track:') ? boxOf(document.querySelector(TIMELINE)) : null
  // On the timeline, only the part inside the scrolled lane is on screen.
  const minX = lane ? lane.left : 0
  const maxX = lane ? lane.left + lane.width : window.innerWidth
  const visibleLeft = clamp(box.left, minX, maxX)
  const visibleRight = clamp(box.left + box.width, minX, maxX)
  const x = isItem ? box.left + Math.min(24, box.width / 2) : (visibleLeft + visibleRight) / 2
  return {
    x: clamp(x, minX, maxX),
    y: clamp(box.top + box.height / 2, 0, window.innerHeight),
  }
}
