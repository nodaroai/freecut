import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudioStore } from '../stores/studio-store'
import { handleStudio, pressHostButton } from './studio-message'
import { parseHostButtons } from './studio-host-buttons'

beforeEach(() => {
  useStudioStore.setState({ hostButtons: [], origin: null, on: false })
})

function studio(payload: Record<string, unknown>, origin = 'https://parent.test'): void {
  handleStudio(new MessageEvent('message', { data: { type: 'NODARO_STUDIO', payload }, origin }))
}

describe('parseHostButtons', () => {
  it('keeps valid buttons in order', () => {
    expect(
      parseHostButtons([
        { id: 'soundtrack', label: 'Soundtrack' },
        { id: 'b2-x', label: '  Two  ' },
      ]),
    ).toEqual([
      { id: 'soundtrack', label: 'Soundtrack' },
      { id: 'b2-x', label: 'Two' },
    ])
  })

  it('gives no buttons for anything that is not an array', () => {
    expect(parseHostButtons(undefined)).toEqual([])
    expect(parseHostButtons(null)).toEqual([])
    expect(parseHostButtons('soundtrack')).toEqual([])
    expect(parseHostButtons({ id: 'a', label: 'A' })).toEqual([])
  })

  it('drops buttons with a bad id', () => {
    const ids = ['Upper', '1digit', '-dash', 'has space', 'a'.repeat(33), 'ok_under', '', 7]
    expect(parseHostButtons(ids.map((id) => ({ id, label: 'L' })))).toEqual([])
    expect(parseHostButtons([{ id: 'a'.repeat(32), label: 'L' }])).toEqual([
      { id: 'a'.repeat(32), label: 'L' },
    ])
  })

  it('drops non-objects and empty or non-string labels', () => {
    expect(
      parseHostButtons([null, 'x', { id: 'a' }, { id: 'b', label: '   ' }, { id: 'c', label: 3 }]),
    ).toEqual([])
  })

  it('cuts labels to 40 characters after trimming', () => {
    const [button] = parseHostButtons([{ id: 'a', label: `  ${'x'.repeat(50)}  ` }])
    expect(button?.label).toBe('x'.repeat(40))
  })

  it('cuts labels by code points, never splitting a surrogate pair', () => {
    const note = '\u{1F3B5}'
    const [button] = parseHostButtons([{ id: 'a', label: note.repeat(45) }])
    expect(button?.label).toBe(note.repeat(40))
  })

  it('drops a label with nothing visible in it', () => {
    expect(
      parseHostButtons([
        { id: 'a', label: '​​' },
        { id: 'b', label: ' ‍﻿ ' },
      ]),
    ).toEqual([])
    expect(parseHostButtons([{ id: 'a', label: '​Music' }])).toEqual([{ id: 'a', label: '​Music' }])
  })

  it('keeps the first of a repeated id, before counting three', () => {
    const list = [
      { id: 'a', label: 'First' },
      { id: 'a', label: 'Second' },
      { id: 'b', label: 'B' },
      { id: 'a', label: 'Third' },
      { id: 'c', label: 'C' },
    ]
    expect(parseHostButtons(list)).toEqual([
      { id: 'a', label: 'First' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ])
  })

  it('keeps at most three', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id }))
    expect(parseHostButtons(many).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('counts only the valid ones toward three', () => {
    const list = [{ id: 'BAD', label: 'x' }, ...['a', 'b', 'c'].map((id) => ({ id, label: id }))]
    expect(parseHostButtons(list).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('NODARO_STUDIO hostButtons', () => {
  it('stores the parsed buttons', () => {
    studio({
      hostButtons: [
        { id: 'soundtrack', label: 'Soundtrack' },
        { id: 'X', label: 'x' },
      ],
    })
    expect(useStudioStore.getState().hostButtons).toEqual([
      { id: 'soundtrack', label: 'Soundtrack' },
    ])
  })

  it('clears them when a later message leaves them out', () => {
    studio({ hostButtons: [{ id: 'soundtrack', label: 'Soundtrack' }] })
    studio({ sideOpen: true })
    expect(useStudioStore.getState().hostButtons).toEqual([])
  })
})

describe('pressHostButton', () => {
  const parent = { postMessage: vi.fn() }
  let parentSpy: { mockRestore: () => void } | undefined

  beforeEach(() => {
    parent.postMessage.mockClear()
    // In the test page the window is its own parent; give it a distinct one.
    parentSpy = vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
  })
  afterEach(() => parentSpy?.mockRestore())

  function fakeButton(): HTMLButtonElement {
    const button = document.createElement('button')
    button.getBoundingClientRect = () =>
      ({ x: 10, y: 4, width: 90, height: 28, top: 4, left: 10, right: 100, bottom: 32 }) as DOMRect
    return button
  }

  it('posts the id and the button rect to the parent origin', () => {
    studio({ hostButtons: [{ id: 'soundtrack', label: 'Soundtrack' }] }, 'https://parent.test')

    pressHostButton('soundtrack', fakeButton())

    expect(parent.postMessage).toHaveBeenCalledWith(
      {
        type: 'FREECUT_STUDIO_ACTION',
        payload: {
          action: 'host-button',
          id: 'soundtrack',
          rect: { x: 10, y: 4, width: 90, height: 28 },
        },
      },
      'https://parent.test',
    )
  })

  it('posts nothing before a parent has asked for the studio', () => {
    pressHostButton('soundtrack', fakeButton())
    expect(parent.postMessage).not.toHaveBeenCalled()
  })
})
