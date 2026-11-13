// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

// Reading media goes through storage; stand-ins answer for one audio file.
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: {
    getMedia: vi.fn(async (id: string) =>
      id === 'music-1'
        ? {
            id: 'music-1',
            fileName: 'bright-pulse.mp3',
            mimeType: 'audio/mpeg',
            duration: 120,
            width: 0,
            height: 0,
            fps: 30,
          }
        : null,
    ),
    getThumbnailBlobUrl: vi.fn(async () => null),
  },
}))
vi.mock('@/features/media-library/utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn(async () => 'blob:music'),
}))

import type { VideoItem } from '@/types/timeline'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { embeddedEditOpEngine } from './embedded-edit-ops'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 300,
    label: 'take.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 300,
    sourceDuration: 300,
    sourceFps: 30,
    ...overrides,
  }
}

const VIDEO_TRACK = {
  id: 'video-track',
  name: 'V1',
  kind: 'video' as const,
  height: 60,
  locked: false,
  visible: true,
  muted: false,
  solo: false,
  order: 0,
  items: [],
}

const apply = async (op: Record<string, unknown> & { op: string }) =>
  embeddedEditOpEngine.apply(await embeddedEditOpEngine.prepare(op))

const items = () => useItemsStore.getState().items

beforeEach(() => {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useEditorStore.setState({ linkedSelectionEnabled: true })
  useItemsStore.getState().setTracks([VIDEO_TRACK])
  useItemsStore.getState().setItems([makeVideoItem()])
  useTransitionsStore.getState().setTransitions([])
  useKeyframesStore.getState().setKeyframes([])
  useSelectionStore.getState().clearSelection()
  useProjectStore.setState({
    currentProject: {
      id: 'p1',
      name: 'Take',
      metadata: { width: 1080, height: 1920, fps: 30, backgroundColor: '#000000' },
    } as never,
  })
})

describe('removeSourceRanges', () => {
  it('cuts media seconds out of the clip and closes the gaps', async () => {
    const result = await apply({
      op: 'removeSourceRanges',
      mediaId: 'media-1',
      ranges: [
        { start: 2, end: 4 },
        { start: 6, end: 7 },
      ],
    })

    expect(result).toEqual({ removedRangeCount: 2, removedItemCount: 2 })
    const spans = items()
      .toSorted((a, b) => a.from - b.from)
      .map((item) => [item.from, item.durationInFrames])
    expect(spans).toEqual([
      [0, 60],
      [60, 60],
      [120, 90],
    ])
  })

  it('refuses a media file with no clip on the timeline', async () => {
    await expect(
      apply({ op: 'removeSourceRanges', mediaId: 'other', ranges: [{ start: 1, end: 2 }] }),
    ).rejects.toThrow('No clip of media other is on the timeline')
  })

  it('refuses a range that ends before it starts', async () => {
    await expect(
      apply({ op: 'removeSourceRanges', mediaId: 'media-1', ranges: [{ start: 3, end: 2 }] }),
    ).rejects.toThrow('ranges[0] needs a start and a later end')
  })
})

describe('addTranscriptCaptions', () => {
  it('captions every piece of the media on a caption track, in timeline time after cuts', async () => {
    await apply({ op: 'removeSourceRanges', mediaId: 'media-1', ranges: [{ start: 2, end: 4 }] })

    const result = (await apply({
      op: 'addTranscriptCaptions',
      mediaId: 'media-1',
      cues: [
        { text: 'Here is how', start: 0.5, end: 1.5 },
        { text: 'I plan a week', start: 4.5, end: 6 },
      ],
    })) as { insertedItemCount: number }

    expect(result.insertedItemCount).toBe(2)
    const captions = items()
      .filter((item) => item.type !== 'video')
      .toSorted((a, b) => a.from - b.from)
    expect(captions).toHaveLength(2)
    // The second cue starts 0.5 s into the second piece, which now starts at 2 s.
    expect(captions[1]!.from).toBe(75)
    expect(useItemsStore.getState().tracks.length).toBe(2)
  })

  it('refuses cues that fall outside every clip', async () => {
    await expect(
      apply({
        op: 'addTranscriptCaptions',
        mediaId: 'media-1',
        cues: [{ text: 'too late', start: 50, end: 51 }],
      }),
    ).rejects.toThrow('None of the cues falls inside a clip')
  })
})

describe('placeMedia', () => {
  it('puts an audio file on a new audio track at the frame, trimmed and at the asked volume', async () => {
    const result = (await apply({
      op: 'placeMedia',
      mediaId: 'music-1',
      from: 0,
      durationInFrames: 300,
      volumeDb: -14,
    })) as { id: string; trackId: string }

    const placed = items().find((item) => item.id === result.id)
    expect(placed).toMatchObject({ type: 'audio', from: 0, durationInFrames: 300, volume: -14 })
    expect(useItemsStore.getState().tracks.find((t) => t.id === result.trackId)?.kind).toBe('audio')
  })

  it('refuses media that is not in Media', async () => {
    await expect(apply({ op: 'placeMedia', mediaId: 'missing' })).rejects.toThrow(
      'Media missing is not in Media',
    )
  })
})

describe('headless fallback', () => {
  it('applies a headless operation to the open project', async () => {
    const result = (await apply({ op: 'addText', text: 'Title', trackId: 'video-track' })) as {
      id?: string
    }
    expect(items().some((item) => item.type === 'text')).toBe(true)
    expect(result).toBeTruthy()
  })
})
