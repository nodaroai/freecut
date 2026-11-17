import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { targetBox, targetPoint } from './presence-targets'

/** An element with a box on screen (jsdom lays nothing out). */
function element(html: string, box: { left: number; top: number; width: number; height: number }) {
  const holder = document.createElement('div')
  holder.innerHTML = html
  const el = holder.firstElementChild as HTMLElement
  el.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
    }) as DOMRect
  return el
}

let root: HTMLElement
beforeEach(() => {
  root = document.createElement('div')
  document.body.append(root)
})
afterEach(() => root.remove())

describe('presence targets', () => {
  it('finds an element marked with the name, and points at its middle', () => {
    root.append(
      element('<button data-presence-target="tool.razor"></button>', {
        left: 100,
        top: 40,
        width: 24,
        height: 24,
      }),
    )

    const box = targetBox('tool.razor')
    expect(box).toEqual({ left: 100, top: 40, width: 24, height: 24 })
    expect(targetPoint('tool.razor', box!)).toEqual({ x: 112, y: 52 })
  })

  it('skips a marked element that is not on screen', () => {
    root.append(
      element('<div data-presence-target="panel.media"></div>', {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      }),
    )
    root.append(
      element('<div data-presence-target="panel.media"></div>', {
        left: 10,
        top: 10,
        width: 200,
        height: 300,
      }),
    )

    expect(targetBox('panel.media')).toEqual({
      left: 10,
      top: 10,
      width: 200,
      height: 300,
    })
    expect(targetBox('tool.select')).toBeNull()
  })

  it('finds media, tracks and items by id', () => {
    root.append(
      element('<div data-media-id="m &quot;1&quot;"></div>', {
        left: 5,
        top: 5,
        width: 80,
        height: 60,
      }),
    )
    const timeline = element('<div data-timeline-scroll-container></div>', {
      left: 200,
      top: 500,
      width: 600,
      height: 200,
    })
    const track = element('<div data-track-id="v1"></div>', {
      left: -400,
      top: 520,
      width: 3000,
      height: 50,
    })
    const item = element('<div data-item-id="clip-1"></div>', {
      left: 300,
      top: 525,
      width: 100,
      height: 40,
    })
    timeline.append(track, item)
    root.append(timeline)

    expect(targetBox('media.item:m "1"')).toEqual({
      left: 5,
      top: 5,
      width: 80,
      height: 60,
    })
    // A track wider than the lane is pointed at in the middle of the part on screen.
    expect(targetPoint('timeline.track:v1', targetBox('timeline.track:v1')!)).toEqual({
      x: 500,
      y: 545,
    })
    expect(targetPoint('timeline.item:clip-1', targetBox('timeline.item:clip-1')!)).toEqual({
      x: 324,
      y: 545,
    })
  })

  it('knows the parts the editor already marks', () => {
    root.append(
      element('<div data-player-container></div>', {
        left: 300,
        top: 50,
        width: 640,
        height: 360,
      }),
    )

    expect(targetBox('preview.canvas')).toEqual({
      left: 300,
      top: 50,
      width: 640,
      height: 360,
    })
  })

  describe('lanes', () => {
    const header = (id: string, kind: string, top: number) =>
      element(`<div data-track-id="${id}" data-track-kind="${kind}"></div>`, {
        left: 0,
        top,
        width: 200,
        height: 60,
      })

    function timelineWith(rows: ReadonlyArray<[trackId: string, itemType: string]>) {
      const timeline = document.createElement('div')
      timeline.setAttribute('data-timeline-scroll-container', '')
      timeline.innerHTML = rows
        .map(
          ([id, type]) =>
            `<div data-track-id="${id}"><div data-timeline-item data-item-type="${type}"></div></div>`,
        )
        .join('')
      return timeline
    }

    it('is the header of the track that holds that kind of clip', () => {
      root.append(header('v1', 'video', 100), header('t1', 'video', 40), header('a1', 'audio', 160))
      root.append(
        timelineWith([
          ['v1', 'video'],
          ['t1', 'text'],
          ['a1', 'audio'],
        ]),
      )
      expect(targetBox('lane.text')?.top).toBe(40)
      expect(targetBox('lane.audio')?.top).toBe(160)
    })

    it('falls back to the first track on the same side when no track holds it yet', () => {
      root.append(header('v1', 'video', 100), header('a1', 'audio', 160))
      root.append(
        timelineWith([
          ['v1', 'video'],
          ['a1', 'audio'],
        ]),
      )
      expect(targetBox('lane.image')?.top).toBe(100)
      expect(targetBox('lane.adjustment')?.top).toBe(100)
    })

    it('seats an agent on the right of the header, clear of the track name', () => {
      const box = { left: 0, top: 100, width: 200, height: 60 }
      expect(targetPoint('lane.video', box)).toEqual({ x: 154, y: 112 })
    })
  })
})
