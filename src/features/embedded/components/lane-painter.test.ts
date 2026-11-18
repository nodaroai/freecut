import { afterEach, describe, expect, it } from 'vitest'
import { laneOf, paintLanes } from './lane-painter'

afterEach(() => {
  document.body.innerHTML = ''
})

function editor(rows: ReadonlyArray<[trackId: string, types: string[]]>) {
  document.body.innerHTML = `
    ${rows.map(([id]) => `<div data-track-id="${id}" data-track-kind="video"></div>`).join('')}
    <div data-timeline-scroll-container>
      ${rows
        .map(
          ([id, types]) =>
            `<div data-track-id="${id}">${types
              .map((t) => `<div data-timeline-item data-item-type="${t}"></div>`)
              .join('')}</div>`,
        )
        .join('')}
    </div>`
}

describe('lane painter', () => {
  it('a lane is the kind most of its clips are', () => {
    editor([['t1', ['subtitle', 'subtitle', 'text']]])
    expect(
      laneOf(document.querySelector('[data-timeline-scroll-container] [data-track-id]')!),
    ).toBe('subtitle')
  })

  it('marks each track header and row with its lane, and an empty track with none', () => {
    editor([
      ['v1', ['video', 'video']],
      ['a1', []],
    ])
    paintLanes()
    const lanes = [...document.querySelectorAll('[data-track-id]')].map((el) =>
      el.getAttribute('data-lane'),
    )
    expect(lanes).toEqual(['video', null, 'video', null])
  })

  it('takes the mark off a track whose clips are gone', () => {
    editor([['v1', ['image']]])
    paintLanes()
    document.querySelector('[data-timeline-item]')!.remove()
    paintLanes()
    expect(document.querySelector('[data-lane]')).toBeNull()
  })
})
