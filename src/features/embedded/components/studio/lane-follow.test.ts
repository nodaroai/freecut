import { describe, expect, it } from 'vitest'
import { addedLanes } from './lane-follow'

describe('addedLanes', () => {
  it('names the lanes that are new, in their order', () => {
    expect(addedLanes([{ id: 'v1' }], [{ id: 't1' }, { id: 'v1' }, { id: 't2' }])).toEqual([
      't1',
      't2',
    ])
  })

  it('names none when lanes are only moved or removed', () => {
    expect(addedLanes([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }])).toEqual([])
  })
})
