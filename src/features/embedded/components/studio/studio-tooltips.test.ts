import { describe, expect, it } from 'vitest'
import { tooltipsBelow } from './studio-tooltips'

describe('the timeline toolbar tooltips in the studio', () => {
  it('open below, unless a button names its own side', () => {
    document.body.innerHTML = `
      <div data-editor-pane="timeline">
        <div>
          <button id="a" data-tooltip="Razor"></button>
          <button id="b" data-tooltip="Snap" data-tooltip-side="left"></button>
        </div>
        <div><button id="c" data-tooltip="Track"></button></div>
      </div>`
    expect(tooltipsBelow()).toBe(1)
    expect(document.getElementById('a')?.getAttribute('data-tooltip-side')).toBe('bottom')
    expect(document.getElementById('b')?.getAttribute('data-tooltip-side')).toBe('left')
    expect(document.getElementById('c')?.hasAttribute('data-tooltip-side')).toBe(false)
  })

  it('does nothing before the timeline is drawn', () => {
    document.body.innerHTML = '<div></div>'
    expect(tooltipsBelow()).toBe(0)
  })
})
