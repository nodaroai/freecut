import { describe, expect, it } from 'vitest'
import type { PresenceCursor, PresenceGesture } from '../stores/presence-store'
import { layoutGesture, type GestureElements } from './presence-gesture-layout'
import type { Measured } from './presence-measure'

const LANE = { left: 0, top: 400, width: 1000, height: 200 }
const PREVIEW = { left: 100, top: 0, width: 400, height: 200 }

/** A timeline at 10 px per frame from x = 0, one track, and a preview. */
const m: Measured = {
  timelineBox: LANE,
  itemBox: () => null,
  trackBox: (id) => (id === 'v1' ? { left: 0, top: 450, width: 5000, height: 40 } : null),
  frameX: (frame) => frame * 10,
  previewBox: PREVIEW,
}

const cursor: PresenceCursor = { id: 'c', name: 'C', color: '#fff' }
const gesture = (g: object) => ({ key: 'k', ...g }) as PresenceGesture

describe('gesture layout', () => {
  it('moves a dragging cursor from its place to the drop, eased', () => {
    const drag = gesture({ kind: 'drag', to: { frame: 50, trackId: 'v1' }, durationMs: 900 })
    const base = { x: 100, y: 100 }

    expect(layoutGesture(cursor, drag, base, 0, m, {})).toEqual(base)
    expect(layoutGesture(cursor, drag, base, 0.5, m, {})).toEqual({ x: 300, y: 285 })
    expect(layoutGesture(cursor, drag, base, 1, m, {})).toEqual({ x: 500, y: 470 })
  })

  it('reveals typed text as it plays', () => {
    const typed = document.createElement('span')
    const type = gesture({ kind: 'type', text: 'Big title', durationMs: 1000 })

    layoutGesture(cursor, type, { x: 0, y: 0 }, 0.5, m, { typed })
    expect(typed.textContent).toBe('Big t')
    layoutGesture(cursor, type, { x: 0, y: 0 }, 1, m, { typed })
    expect(typed.textContent).toBe('Big title')
  })

  it('draws a lasso over the preview and keeps the cursor at its pen', () => {
    const els: GestureElements = {
      lasso: document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      lassoLine: document.createElementNS('http://www.w3.org/2000/svg', 'polyline'),
    }
    const lasso = gesture({
      kind: 'lasso',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      durationMs: 1000,
    })

    expect(layoutGesture(cursor, lasso, null, 0.25, m, els)).toEqual({ x: 200, y: 0 })
    expect(els.lassoLine!.style.strokeDashoffset).toBe('0.75')
    expect(els.lasso!.style.transform).toBe('translate(100px, 0px)')
  })

  it('grows a marquee over its frames with the cursor at its edge', () => {
    const marquee = document.createElement('div')
    const span = gesture({ kind: 'marquee', trackId: 'v1', from: 10, to: 30 })

    expect(layoutGesture(cursor, span, null, 1, m, { marquee })).toEqual({ x: 300, y: 470 })
    expect(marquee.style.width).toBe('200px')
    expect(marquee.style.transform).toBe('translate(100px, 450px)')
  })
})
