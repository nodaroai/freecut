import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineTrack, VideoItem } from '@/types/timeline'
import { ColorTimelineNavigator } from './color-timeline-navigator'

const VIDEO_TRACK: TimelineTrack = {
  id: 'v1',
  name: 'V1',
  kind: 'video',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 1,
  items: [],
}

const AUDIO_TRACK: TimelineTrack = {
  id: 'a1',
  name: 'A1',
  kind: 'audio',
  height: 64,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const VIDEO_ITEM: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'v1',
  from: 48,
  durationInFrames: 120,
  label: 'shot-01.mp4',
  src: 'blob:shot',
  thumbnailUrl: 'blob:thumb',
}

describe('ColorTimelineNavigator', () => {
  beforeEach(() => {
    useItemsStore.getState().setTracks([VIDEO_TRACK, AUDIO_TRACK])
    useItemsStore.getState().setItems([VIDEO_ITEM])
    useTimelineStore.setState({ fps: 24 })
    useSelectionStore.getState().clearSelection()
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
      frameUpdateEpoch: 0,
      currentFrameEpoch: 0,
      previewFrameEpoch: 0,
    })
  })

  it('renders a compact timeline strip for color mode', () => {
    render(<ColorTimelineNavigator />)

    expect(screen.getByTestId('color-timeline-navigator')).toBeInTheDocument()
    expect(screen.getByText('V1')).toBeInTheDocument()
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
    expect(screen.getAllByTitle('shot-01.mp4').length).toBeGreaterThan(0)
  })

  it('selects a clip and seeks to its first frame', async () => {
    usePlaybackStore.getState().setScrubFrame(12, 'stale-scrub')

    render(<ColorTimelineNavigator />)

    fireEvent.click(screen.getAllByTitle('shot-01.mp4')[0]!)

    expect(useSelectionStore.getState().selectedItemIds).toEqual(['clip-1'])
    expect(usePlaybackStore.getState().currentFrame).toBe(48)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(usePlaybackStore.getState().previewItemId).toBeNull()
  })

  it('scrubs the compact strip while dragging and clears the preview on release', async () => {
    usePlaybackStore.setState({ isPlaying: true })
    render(<ColorTimelineNavigator />)

    const scrubSurface = screen.getByTestId('color-timeline-scrub-surface')
    scrubSurface.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 96,
      width: 600,
      height: 96,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(scrubSurface, { button: 0, clientX: 120, pointerId: 1 })
    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(usePlaybackStore.getState().currentFrame).toBe(60)
    expect(usePlaybackStore.getState().previewFrame).toBe(60)

    // Move commits are rAF-batched — wait for the scheduled frame to land.
    fireEvent.pointerMove(scrubSurface, { clientX: 300, pointerId: 1 })
    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(150)
    })
    expect(usePlaybackStore.getState().previewFrame).toBe(150)

    fireEvent.pointerUp(scrubSurface, { clientX: 300, pointerId: 1 })
    expect(usePlaybackStore.getState().currentFrame).toBe(150)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
  })
})
