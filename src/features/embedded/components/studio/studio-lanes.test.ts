import { describe, expect, it } from 'vitest'
import { hasChosenTrackSize, tightLanes } from './studio-lanes'

describe('the studio lanes', () => {
  it('leaves a Track Size the person chose alone', () => {
    expect(hasChosenTrackSize({ getItem: () => 'large' })).toBe(true)
  })

  it('picks the size itself when nothing was chosen yet', () => {
    expect(hasChosenTrackSize({ getItem: () => null })).toBe(false)
  })

  it('does not touch the lanes when storage cannot be read', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(hasChosenTrackSize(blocked)).toBe(true)
  })

  it('tightens a new lane at the preset height and keeps a lane the person resized', () => {
    const tracks = [
      { id: 'v1', height: 72 },
      { id: 'a1', height: 110 },
    ]
    expect(tightLanes(tracks, new Set(), 72, 48)).toEqual([
      { id: 'v1', height: 48 },
      { id: 'a1', height: 110 },
    ])
  })

  it('leaves a lane it has seen, even one the person set back to the preset height', () => {
    expect(tightLanes([{ id: 'v1', height: 72 }], new Set(['v1']), 72, 48)).toBeNull()
  })

  it('changes nothing once every lane is tight', () => {
    expect(tightLanes([{ id: 'v1', height: 48 }], new Set(), 72, 48)).toBeNull()
  })
})
