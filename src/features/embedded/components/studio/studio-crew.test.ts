import { describe, expect, it } from 'vitest'
import { crewOf } from './studio-crew'

describe('the crew in the top bar', () => {
  it('is one member per agent, at work when any of its cursors is', () => {
    expect(
      crewOf([
        { id: 'snip#station', name: 'Snip', color: '#f0f', mood: 'waiting' },
        { id: 'echo#station', name: 'Echo', color: '#0ff', mood: 'done' },
        { id: 'snip', name: 'Snip', color: '#f0f' },
      ]).map((m) => [m.id, m.mood]),
    ).toEqual([
      ['snip', 'working'],
      ['echo', 'done'],
    ])
  })
})
