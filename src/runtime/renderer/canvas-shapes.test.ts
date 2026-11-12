// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { renderShape } from './canvas-shapes'

const shape: ShapeItem = {
  id: 'gradient-shape',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Gradient',
  shapeType: 'rectangle',
  fillColor: '#112233',
  fillType: 'linear',
  gradientEndColor: '#aabbcc',
  gradientAngle: 0,
  transform: { x: 0, y: 0, width: 200, height: 100 },
}

const transform: ResolvedTransform = {
  x: 0,
  y: 0,
  anchorX: 0,
  anchorY: 0,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

const perimeterCases: Array<{
  name: string
  overrides: Partial<ShapeItem>
  expected: number
}> = [
  {
    name: 'rounded rectangle',
    overrides: { shapeType: 'rectangle', cornerRadius: 10 },
    expected: 582.8318530717959,
  },
  {
    name: 'unlocked ellipse',
    overrides: {
      shapeType: 'ellipse',
      transform: { ...shape.transform!, aspectRatioLocked: false },
    },
    expected: 484.4210548835644,
  },
  { name: 'heart', overrides: { shapeType: 'heart' }, expected: 335 },
  {
    name: 'horizontal unlocked triangle',
    overrides: {
      shapeType: 'triangle',
      direction: 'left',
      transform: { ...shape.transform!, aspectRatioLocked: false },
    },
    expected: 512.3105625617661,
  },
]

describe('renderShape Canvas gradients', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', class {})
  })

  it('creates the same edge-to-edge two-stop gradient used by live and GPU rendering', () => {
    const addColorStop = vi.fn()
    const gradient = { addColorStop }
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 4,
      lineWidth: 0,
      lineDashOffset: 0,
    } as unknown as OffscreenCanvasRenderingContext2D

    renderShape(context, shape, { ...transform, rotation: 90 }, { width: 1920, height: 1080 })

    expect(context.createLinearGradient).toHaveBeenCalledWith(960, 440, 960, 640)
    expect(addColorStop).toHaveBeenNthCalledWith(1, 0, '#112233')
    expect(addColorStop).toHaveBeenNthCalledWith(2, 1, '#aabbcc')
    expect(context.fill).toHaveBeenCalledTimes(1)
  })

  it.each(perimeterCases)(
    'uses the $name perimeter for trim-path dashes',
    ({ overrides, expected }) => {
      const context = {
        save: vi.fn(),
        restore: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
        globalAlpha: 1,
        fillStyle: '',
        strokeStyle: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        miterLimit: 4,
        lineWidth: 0,
        lineDashOffset: 0,
      } as unknown as OffscreenCanvasRenderingContext2D
      const trimmedShape: ShapeItem = {
        ...shape,
        fillEnabled: false,
        strokeEnabled: true,
        strokeColor: '#ffffff',
        strokeWidth: 2,
        trimPathStart: 0,
        trimPathEnd: 50,
        ...overrides,
      }

      renderShape(context, trimmedShape, transform, { width: 1920, height: 1080 })

      const [dash, gap] = vi.mocked(context.setLineDash).mock.calls[0]![0]
      expect(dash).toBeCloseTo(expected / 2)
      expect(gap).toBeCloseTo(expected / 2)
    },
  )
})
