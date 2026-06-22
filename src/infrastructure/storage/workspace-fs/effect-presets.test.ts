import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { readUserEffectPresets, saveUserEffectPresets } from './effect-presets'

const mocks = vi.hoisted(() => ({
  root: { kind: 'mock-root' },
  readJson: vi.fn(),
  writeJsonAtomic: vi.fn(),
}))

vi.mock('./root', () => ({
  requireWorkspaceRoot: () => mocks.root,
}))

vi.mock('./fs-primitives', () => ({
  readJson: (...args: unknown[]) => mocks.readJson(...args),
  writeJsonAtomic: (...args: unknown[]) => mocks.writeJsonAtomic(...args),
}))

describe('workspace effect presets storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads and sanitizes user grade presets from app/effect-presets.json', async () => {
    mocks.readJson.mockResolvedValue({
      version: 1,
      presets: [
        {
          id: 'preset-1',
          name: 'Warm grade',
          effects: [
            {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-color-wheels',
              params: { temperature: 12 },
            },
            { type: 'not-valid' },
          ],
          createdAt: 123,
        },
        {
          id: 'empty',
          name: 'No effects',
          effects: [],
        },
      ],
    })

    await expect(readUserEffectPresets()).resolves.toEqual([
      {
        id: 'preset-1',
        name: 'Warm grade',
        effects: [
          {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-color-wheels',
            params: { temperature: 12 },
          },
        ],
        createdAt: 123,
      },
    ])
    expect(mocks.readJson).toHaveBeenCalledWith(mocks.root, ['app', 'effect-presets.json'])
  })

  it('writes user grade presets atomically under the workspace app folder', async () => {
    const preset = {
      id: 'preset-1',
      name: 'Cool grade',
      effects: [
        {
          type: 'gpu-effect' as const,
          gpuEffectType: 'gpu-curves',
          params: { masterPoints: '[[0,0],[1,1]]' },
        },
      ],
      createdAt: 456,
    }

    await saveUserEffectPresets([preset])

    expect(mocks.writeJsonAtomic).toHaveBeenCalledWith(mocks.root, ['app', 'effect-presets.json'], {
      version: 1,
      presets: [preset],
    })
  })
})
