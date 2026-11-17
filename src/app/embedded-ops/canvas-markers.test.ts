// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const stored = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }))
vi.mock('@/infrastructure/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/storage')>()),
  updateProject: vi.fn(async (id: string, updates: unknown) => {
    stored.calls.push([id, updates])
    return {}
  }),
}))

import { useProjectStore } from '@/features/projects/stores/project-store'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { embeddedEditOpEngine } from '../embedded-edit-ops'

type Op = Record<string, unknown> & { op: string }

/** Ops applied as the bridge applies a request: prepared, then one batch. */
async function batch(...ops: Op[]) {
  const prepared: Op[] = []
  for (const op of ops) prepared.push(await embeddedEditOpEngine.prepare(op))
  return useTimelineCommandStore
    .getState()
    .executeBatch({ type: 'APPLY_EDIT_OPS', payload: { count: ops.length } }, () =>
      prepared.map((op) => embeddedEditOpEngine.apply(op)),
    )
}

const canvas = () => useProjectStore.getState().currentProject!.metadata

beforeEach(() => {
  stored.calls = []
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
  useItemsStore.getState().setTracks([])
  useItemsStore.getState().setItems([])
  useMarkersStore.getState().setMarkers([])
  const project = {
    id: 'p1',
    name: 'Take',
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
  }
  useProjectStore.setState({ currentProject: project as never, projects: [project as never] })
})

describe('setCanvas', () => {
  it('sets the project size and stores it once the batch has landed', async () => {
    const [result] = await batch({ op: 'setCanvas', width: 1080, height: 1920 })

    expect(result).toEqual({ width: 1080, height: 1920 })
    expect(canvas()).toMatchObject({ width: 1080, height: 1920, fps: 30 })
    expect(useProjectStore.getState().projects[0]!.metadata).toMatchObject({ width: 1080 })
    await Promise.resolve()
    expect(stored.calls).toEqual([
      ['p1', { metadata: expect.objectContaining({ width: 1080, height: 1920 }) }],
    ])
  })

  it('is undone with its batch', async () => {
    await batch({ op: 'setCanvas', width: 1080, height: 1920 })
    useTimelineCommandStore.getState().undo()

    expect(canvas()).toMatchObject({ width: 1920, height: 1080 })
  })

  it('leaves the old size when a later operation of the batch fails', async () => {
    await expect(
      batch({ op: 'setCanvas', width: 1080, height: 1920 }, { op: 'removeMarkers', ids: ['nope'] }),
    ).rejects.toThrow('marker "nope" does not exist')
    await Promise.resolve()

    expect(canvas()).toMatchObject({ width: 1920, height: 1080 })
    expect(stored.calls.at(-1)?.[1]).toEqual({ metadata: expect.objectContaining({ width: 1920 }) })
  })

  it('rounds to even pixels and refuses a size the project cannot hold', async () => {
    const [result] = await batch({ op: 'setCanvas', width: 1081, height: 1349 })
    expect(result).toEqual({ width: 1082, height: 1350 })

    await expect(batch({ op: 'setCanvas', width: 100, height: 1080 })).rejects.toThrow(
      'setCanvas: `width` must be from 320 to 7680 pixels',
    )
    await expect(batch({ op: 'setCanvas', width: 1920 })).rejects.toThrow(
      'setCanvas: `height` must be a number of pixels from 240 to 4320',
    )
  })
})

describe('addMarkers and removeMarkers', () => {
  it('adds markers and answers their ids', async () => {
    const [result] = (await batch({
      op: 'addMarkers',
      markers: [{ frame: 30, label: 'Hook', color: '#FFB020' }, { frame: 90.4 }],
    })) as [{ ids: string[] }]

    const markers = useMarkersStore.getState().markers
    expect(result.ids).toEqual(markers.map((marker) => marker.id))
    expect(markers).toMatchObject([
      { frame: 30, label: 'Hook', color: '#FFB020' },
      { frame: 90, label: '' },
    ])
  })

  it('refuses a marker with a bad frame or color', async () => {
    await expect(batch({ op: 'addMarkers', markers: [{ frame: -2 }] })).rejects.toThrow(
      'addMarkers: markers[0].frame must be a frame number, 0 or more',
    )
    await expect(
      batch({ op: 'addMarkers', markers: [{ frame: 2, color: 'url(x)' }] }),
    ).rejects.toThrow('addMarkers: markers[0].color must be a hex color')
    expect(useMarkersStore.getState().markers).toEqual([])
  })

  it('removes markers by id, or all of them', async () => {
    const [added] = (await batch({
      op: 'addMarkers',
      markers: [{ frame: 1 }, { frame: 2 }, { frame: 3 }],
    })) as [{ ids: string[] }]

    const [removed] = await batch({ op: 'removeMarkers', ids: [added.ids[1]] })
    expect(removed).toEqual({ removed: [added.ids[1]] })
    expect(useMarkersStore.getState().markers.map((m) => m.frame)).toEqual([1, 3])

    const [cleared] = await batch({ op: 'removeMarkers', all: true })
    expect(cleared).toEqual({ removed: [added.ids[0], added.ids[2]] })
    expect(useMarkersStore.getState().markers).toEqual([])
  })

  it('needs ids or all', async () => {
    await expect(batch({ op: 'removeMarkers' })).rejects.toThrow(
      'removeMarkers requires `ids`, a list of marker ids, or `all: true`',
    )
  })
})
