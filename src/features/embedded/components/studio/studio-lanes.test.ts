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

  it('tightens the lanes at the preset height and keeps a lane the person resized', () => {
    const tracks = [
      { id: 'v1', height: 72 },
      { id: 'a1', height: 110 },
    ]
    expect(tightLanes(tracks, 72, 48)).toEqual([
      { id: 'v1', height: 48 },
      { id: 'a1', height: 110 },
    ])
  })

  it('changes nothing once every lane is tight', () => {
    expect(tightLanes([{ id: 'v1', height: 48 }], 72, 48)).toBeNull()
  })
})
