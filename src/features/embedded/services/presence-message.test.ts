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

describe('NODARO_PRESENCE targets and gestures', () => {
  it('keeps a named target and each gesture the editor draws', () => {
    presence({
      cursors: [
        { id: 'a', name: 'A', color: '#fff', target: 'tool.razor', gesture: { kind: 'click' } },
        {
          id: 'b',
          name: 'B',
          color: '#fff',
          target: 'media.item:m1',
          gesture: { kind: 'drag', to: 'timeline.track:v2', label: 'city.mp4', durationMs: 700 },
        },
        {
          id: 'c',
          name: 'C',
          color: '#fff',
          target: 'rail.text',
          gesture: { kind: 'type', text: 'Big title' },
        },
        {
          id: 'd',
          name: 'D',
          color: '#fff',
          frame: 10,
          gesture: { kind: 'marquee', trackId: 'v1', from: 10, to: 80 },
        },
        {
          id: 'e',
          name: 'E',
          color: '#fff',
          target: 'preview',
          gesture: {
            kind: 'lasso',
            points: [
              { x: 0.2, y: 0.2 },
              { x: 0.8, y: 0.3 },
              { x: 0.5, y: 1.4 },
            ],
          },
        },
        {
          id: 'f',
          name: 'F',
          color: '#fff',
          target: 'prop.gain',
          gesture: { kind: 'slide', from: 0.6, to: 0.3 },
        },
        {
          id: 'g',
          name: 'G',
          color: '#fff',
          target: 'tabs.new',
          gesture: { kind: 'progress', value: 0.4, label: 'Rendering' },
        },
      ],
    })

    const gestures = usePresenceStore.getState().cursors.map(({ target, gesture }) => {
      const { key: _key, ...shape } = gesture!
      return { target, ...shape }
    })
    expect(gestures).toEqual([
      { target: 'tool.razor', kind: 'click' },
      {
        target: 'media.item:m1',
        kind: 'drag',
        to: { target: 'timeline.track:v2' },
        label: 'city.mp4',
        durationMs: 700,
      },
      { target: 'rail.text', kind: 'type', text: 'Big title', durationMs: 1200 },
      { target: undefined, kind: 'marquee', trackId: 'v1', from: 10, to: 80 },
      {
        target: 'preview',
        kind: 'lasso',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.3 },
          { x: 0.5, y: 1 },
        ],
        durationMs: 1200,
      },
      { target: 'prop.gain', kind: 'slide', from: 0.6, to: 0.3, durationMs: 900 },
      { target: 'tabs.new', kind: 'progress', value: 0.4, label: 'Rendering' },
    ])
  })

  it('drags to a frame of a track', () => {
    presence({
      cursors: [
        {
          id: 'a',
          name: 'A',
          color: '#fff',
          item: 'clip-1',
          gesture: { kind: 'drag', to: { frame: 90.2, trackId: 'v2' } },
        },
      ],
    })
    expect(usePresenceStore.getState().cursors[0]!.gesture).toMatchObject({
      kind: 'drag',
      to: { frame: 90, trackId: 'v2' },
      durationMs: 900,
    })
  })

  it('drops a gesture it cannot draw, and keeps the cursor', () => {
    presence({
      cursors: [
        { id: 'a', name: 'A', color: '#fff', target: 'tool.select', gesture: { kind: 'wave' } },
        {
          id: 'b',
          name: 'B',
          color: '#fff',
          target: 'preview',
          gesture: { kind: 'lasso', points: [{ x: 0.1, y: 0.1 }] },
        },
        {
          id: 'c',
          name: 'C',
          color: '#fff',
          frame: 3,
          gesture: { kind: 'marquee', trackId: 'v1', from: 9, to: 2 },
        },
      ],
    })
    const cursors = usePresenceStore.getState().cursors
    expect(cursors.map((cursor) => cursor.id)).toEqual(['a', 'b', 'c'])
    expect(cursors.every((cursor) => cursor.gesture === undefined)).toBe(true)
  })

  it('gives a repeated gesture the same key, a replayed one a new key, and a progress badge one key as it fills', () => {
    const keyOf = (gesture: Record<string, unknown>) => {
      presence({ cursors: [{ id: 'a', name: 'A', color: '#fff', target: 'tool.razor', gesture }] })
      return usePresenceStore.getState().cursors[0]!.gesture!.key
    }
    expect(keyOf({ kind: 'click' })).toBe(keyOf({ kind: 'click' }))
    expect(keyOf({ kind: 'click', id: 2 })).not.toBe(keyOf({ kind: 'click', id: 3 }))
    expect(keyOf({ kind: 'progress', value: 0.2 })).toBe(keyOf({ kind: 'progress', value: 0.9 }))
  })
})
