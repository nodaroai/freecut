import { describe, expect, it } from 'vitest'
import { timecode } from './timecode'

describe('the timeline bar timecode', () => {
  it('reads hours, minutes, seconds and frames', () => {
    expect(timecode(0, 25)).toBe('00:00:00:00')
    expect(timecode(25 * 62 + 7, 25)).toBe('00:01:02:07')
    expect(timecode(30 * 3600, 30)).toBe('01:00:00:00')
  })

  it('rounds a fractional rate and never goes below zero', () => {
    expect(timecode(48, 23.976)).toBe('00:00:02:00')
    expect(timecode(-5, 30)).toBe('00:00:00:00')
  })
})
