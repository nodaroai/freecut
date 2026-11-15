import { beforeEach, describe, expect, it } from 'vitest'
import { usePlaybackStore } from '@/shared/state/playback'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useMarkersStore,
  useSequencesStore,
  useTimelineSettingsStore,
} from '../deps/timeline-contract'
import { useProjectStore } from '../deps/projects-contract'
import { readTimeline } from './timeline-report'

const track = (id: string, kind: 'video' | 'audio', order: number, extra = {}): TimelineTrack => ({
  id,
  name: id.toUpperCase(),
  kind,
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order,
  items: [],
  ...extra,
})

const ITEMS = [
  {
    id: 'take',
    type: 'video',
    trackId: 'v1',
    from: 0,
    durationInFrames: 90,
    label: 'take.mp4',
    src: '',
    mediaId: 'm1',
    linkedGroupId: 'g1',
    volume: -3,
    transform: { x: 40, y: -20, width: 1500, height: 844, rotation: 0 },
    effects: [
      {
        id: 'fx1',
        enabled: true,
        effect: { type: 'gpu-effect', gpuEffectType: 'gpu-temperature', params: {} },
      },
    ],
  },
  {
    id: 'take-audio',
    type: 'audio',
    trackId: 'a1',
    from: 0,
    durationInFrames: 90,
    label: 'take.mp4',
    src: '',
    mediaId: 'm1',
    linkedGroupId: 'g1',
  },
  {
    id: 'captions',
    type: 'subtitle',
    trackId: 'v2',
    from: 15,
    durationInFrames: 60,
    label: 'Captions',
    color: '#ffffff',
    source: { type: 'transcript', mediaId: 'm1', clipId: 'take' },
    cues: [{ id: 'c1', startSeconds: 0, endSeconds: 1.5, text: 'Hello there' }],
  },
] as unknown as TimelineItem[]

beforeEach(() => {
  useTimelineSettingsStore.setState({ fps: 30 })
  useItemsStore
    .getState()
    .setTracks([
      track('v2', 'video', -1),
      track('v1', 'video', 0),
      track('a1', 'audio', 1),
      track('music', 'audio', 2, { syncLock: false }),
    ])
  useItemsStore.getState().setItems(ITEMS)
  useMarkersStore.getState().setMarkers([{ id: 'mk1', frame: 30, color: '#ffb020', label: 'Hook' }])
  usePlaybackStore.getState().setCurrentFrame(42)
  useCompositionNavigationStore.getState().resetToRoot()
  useSequencesStore.getState().setTopLevelSequenceIds(['s1'])
  useCompositionsStore.getState().setCompositions([
    {
      id: 's1',
      name: 'Clip 1',
      editorKind: 'sequence',
      items: [],
      tracks: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1080,
      height: 1920,
      durationInFrames: 240,
    },
  ])
  useProjectStore.setState({
    currentProject: { id: 'p1', metadata: { width: 1920, height: 1080, fps: 30 } } as never,
  })
})

describe('the timeline report', () => {
  it('carries the playhead, markers, tabs and each track sync lock', () => {
    const report = readTimeline()

    expect(report.currentFrame).toBe(42)
    expect(report.markers).toEqual([{ id: 'mk1', frame: 30, label: 'Hook', color: '#ffb020' }])
    expect(report.sequences).toEqual([
      { id: 's1', name: 'Clip 1', width: 1080, height: 1920, durationInFrames: 240, active: false },
    ])
    expect(report.tracks.map((t) => [t.id, t.syncLock])).toEqual([
      ['v2', true],
      ['v1', true],
      ['a1', true],
      ['music', false],
    ])
  })

  it('carries each item link, place on the canvas, gain, effects and caption cues', () => {
    const [take, audio, captions] = readTimeline().items

    expect(take).toMatchObject({
      linkedGroupId: 'g1',
      volumeDb: -3,
      transform: { x: 40, y: -20, width: 1500, height: 844 },
      effects: [{ id: 'fx1', type: 'gpu-temperature', enabled: true }],
    })
    expect(audio).toMatchObject({ linkedGroupId: 'g1', volumeDb: 0 })
    expect(audio).not.toHaveProperty('transform')
    expect(captions).toMatchObject({
      cues: [{ startSeconds: 0, endSeconds: 1.5, text: 'Hello there' }],
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    })
  })

  it('marks the open tab active and measures it from the live timeline', () => {
    useCompositionNavigationStore.getState().switchToSequence('s1')
    useItemsStore.getState().setItems([{ ...ITEMS[0]!, durationInFrames: 75 } as TimelineItem])

    expect(readTimeline().sequences).toEqual([
      { id: 's1', name: 'Clip 1', width: 1080, height: 1920, durationInFrames: 75, active: true },
    ])
  })
})
