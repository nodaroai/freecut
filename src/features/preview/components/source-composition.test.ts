import { describe, expect, it } from 'vite-plus/test'
import { shouldResyncPlayingMedia, shouldSeekPlayingMedia } from '../utils/source-media-sync'

describe('source monitor media resync helpers', () => {
  it('only resyncs playing media after the drift exceeds the source monitor threshold', () => {
    expect(shouldResyncPlayingMedia(1, 1 + 5 / 30, 30)).toBe(false)
    expect(shouldResyncPlayingMedia(1, 1 + 6.01 / 30, 30)).toBe(true)
  })

  it('does not issue another playing seek while the media element is already seeking', () => {
    expect(shouldSeekPlayingMedia({ currentTime: 4, seeking: true }, 0, 30)).toBe(false)
  })

  it('allows a new playing seek once the previous media seek has settled and drift is still large', () => {
    expect(shouldSeekPlayingMedia({ currentTime: 4, seeking: false }, 0, 30)).toBe(true)
  })
})
