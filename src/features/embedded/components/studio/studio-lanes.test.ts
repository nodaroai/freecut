import { describe, expect, it } from 'vitest'
import { hasChosenTrackSize } from './studio-lanes'

describe('the studio lanes', () => {
  it('leaves a Track Size the person chose alone', () => {
    expect(hasChosenTrackSize({ getItem: () => 'large' })).toBe(true)
  })

  it('makes the lanes compact when nothing was chosen yet', () => {
    expect(hasChosenTrackSize({ getItem: () => null })).toBe(false)
  })

  it('does not touch the lanes when storage cannot be read', () => {
    expect(
      hasChosenTrackSize({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBe(true)
  })
})
