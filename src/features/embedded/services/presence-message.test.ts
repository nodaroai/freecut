import { beforeEach, describe, expect, it } from 'vitest'
import { handlePresence } from './presence-message'
import { usePresenceStore } from '../stores/presence-store'

const presence = (payload: Record<string, unknown>) =>
  handlePresence(new MessageEvent('message', { data: { type: 'NODARO_PRESENCE', payload } }))

beforeEach(() => usePresenceStore.getState().setPresence([], []))

describe('NODARO_PRESENCE', () => {
  it('keeps cursors and highlights that name a valid place and color', () => {
    presence({
      cursors: [
        { id: 'cut', name: 'Cutter', color: '#ff7a5c', item: 'clip-1', note: 'Cutting 2 of 7' },
        { id: 'frame', name: 'Framer', color: 'rgb(92, 207, 224)', preview: { x: 0.5, y: 1.4 } },
        { id: 'cap', name: 'Captions', color: 'hsl(50, 80%, 60%)', frame: 42.4, trackId: 't1' },
      ],
      highlights: [
        { id: 'p1', color: '#ff7a5c', item: 'clip-1' },
        { id: 'p2', color: '#ff7a5c', trackId: 't1', from: 10, to: 30 },
      ],
    })

    const { cursors, highlights } = usePresenceStore.getState()
    expect(cursors).toEqual([
      { id: 'cut', name: 'Cutter', color: '#ff7a5c', item: 'clip-1', note: 'Cutting 2 of 7' },
      { id: 'frame', name: 'Framer', color: 'rgb(92, 207, 224)', preview: { x: 0.5, y: 1 } },
      { id: 'cap', name: 'Captions', color: 'hsl(50, 80%, 60%)', frame: 42, trackId: 't1' },
    ])
    expect(highlights).toEqual([
      { id: 'p1', color: '#ff7a5c', item: 'clip-1' },
      { id: 'p2', color: '#ff7a5c', trackId: 't1', from: 10, to: 30 },
    ])
  })

  it('drops a color that is not a plain color value', () => {
    presence({
      cursors: [{ id: 'x', name: 'X', color: 'red; background: url(https://example.com)' }],
      highlights: [{ id: 'h', color: 'url(x)', item: 'clip-1' }],
    })

    expect(usePresenceStore.getState().cursors).toEqual([])
    expect(usePresenceStore.getState().highlights).toEqual([])
  })

  it('drops a highlight with no place, and a span that ends before it starts', () => {
    presence({
      highlights: [
        { id: 'a', color: '#fff' },
        { id: 'b', color: '#fff', trackId: 't1', from: 30, to: 10 },
      ],
    })

    expect(usePresenceStore.getState().highlights).toEqual([])
  })

  it('clears the picture when the message is empty', () => {
    presence({ cursors: [{ id: 'cut', name: 'Cutter', color: '#ff7a5c', item: 'clip-1' }] })
    presence({})

    expect(usePresenceStore.getState().cursors).toEqual([])
  })
})
