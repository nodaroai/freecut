import { describe, expect, it } from 'vitest'
import { crewOf, isLive } from './studio-crew'

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

describe('who is at work', () => {
  it('counts an agent working or waiting for the person, not one asleep or done', () => {
    const member = (mood: 'working' | 'waiting' | 'done' | 'needs-you') => ({
      id: 'a',
      name: 'A',
      color: '#fff',
      mood,
    })
    expect(isLive(member('working'))).toBe(true)
    expect(isLive(member('needs-you'))).toBe(true)
    expect(isLive(member('waiting'))).toBe(false)
    expect(isLive(member('done'))).toBe(false)
  })
})
