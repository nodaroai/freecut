// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { MaskVertex } from '@/types/masks'
import { convertVertexToBezier, insertVertexBetween } from './mask-path-utils'

function cubicPoint(vertices: MaskVertex[], t: number): [number, number] {
  const start = vertices[0]!
  const end = vertices.at(-1)!
  const p0 = start.position
  const p1: [number, number] = [p0[0] + start.outHandle[0], p0[1] + start.outHandle[1]]
  const p3 = end.position
  const p2: [number, number] = [p3[0] + end.inHandle[0], p3[1] + end.inHandle[1]]
  const mt = 1 - t
  return [
    mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0],
    mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1],
  ]
}

describe('insertVertexBetween', () => {
  it('splits a cubic without changing its geometry', () => {
    const path: MaskVertex[] = [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0.25, 0.75] },
      { position: [1, 1], inHandle: [-0.25, 0.5], outHandle: [0, 0] },
    ]
    const originalMidpoint = cubicPoint(path, 0.5)
    const split = insertVertexBetween(path, 0, 0.5)

    expect(split).toHaveLength(3)
    expect(split[1]?.position[0]).toBeCloseTo(originalMidpoint[0])
    expect(split[1]?.position[1]).toBeCloseTo(originalMidpoint[1])
    expect(split[1]?.tangentMode).toBe('continuous')

    const leftMidpoint = cubicPoint(split.slice(0, 2), 0.5)
    const rightMidpoint = cubicPoint(split.slice(1), 0.5)
    expect(leftMidpoint[0]).toBeCloseTo(cubicPoint(path, 0.25)[0])
    expect(leftMidpoint[1]).toBeCloseTo(cubicPoint(path, 0.25)[1])
    expect(rightMidpoint[0]).toBeCloseTo(cubicPoint(path, 0.75)[0])
    expect(rightMidpoint[1]).toBeCloseTo(cubicPoint(path, 0.75)[1])
  })
})

describe('convertVertexToBezier', () => {
  it('returns the original array when the target does not exist', () => {
    const path: MaskVertex[] = [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [10, 0], inHandle: [0, 0], outHandle: [0, 0] },
    ]

    expect(convertVertexToBezier(path, -1)).toBe(path)
    expect(convertVertexToBezier(path, path.length)).toBe(path)
  })

  it('synthesizes continuous handles without mutating the source path', () => {
    const path: MaskVertex[] = [
      { position: [-10, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
      { position: [10, 0], inHandle: [0, 0], outHandle: [0, 0] },
    ]

    const converted = convertVertexToBezier(path, 1)

    expect(converted).not.toBe(path)
    expect(converted[1]?.inHandle[0]).toBeCloseTo(-2.5)
    expect(converted[1]?.inHandle[1]).toBeCloseTo(0)
    expect(converted[1]?.outHandle[0]).toBeCloseTo(2.5)
    expect(converted[1]?.outHandle[1]).toBeCloseTo(0)
    expect(converted[1]?.tangentMode).toBe('continuous')
    expect(path[1]).toMatchObject({
      inHandle: [0, 0],
      outHandle: [0, 0],
      tangentMode: 'corner',
    })
  })

  it('preserves existing handle lengths when their directions cancel', () => {
    const path: MaskVertex[] = [
      { position: [-10, 0], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [0, 0], inHandle: [2, 0], outHandle: [4, 0], tangentMode: 'corner' },
      { position: [10, 0], inHandle: [0, 0], outHandle: [0, 0] },
    ]

    const converted = convertVertexToBezier(path, 1)[1]!
    expect(converted.inHandle[0]).toBeCloseTo(-2)
    expect(converted.inHandle[1]).toBeCloseTo(0)
    expect(converted.outHandle[0]).toBeCloseTo(4)
    expect(converted.outHandle[1]).toBeCloseTo(0)
    expect(converted.tangentMode).toBe('continuous')
  })

  it('keeps an open endpoint handle on the path-facing side', () => {
    const path: MaskVertex[] = [
      { position: [0, 0], inHandle: [0, 0], outHandle: [0, 0], tangentMode: 'corner' },
      { position: [20, 0], inHandle: [0, 0], outHandle: [0, 0] },
    ]

    const first = convertVertexToBezier(path, 0, false)[0]!
    expect(Math.abs(first.inHandle[0])).toBe(0)
    expect(Math.abs(first.inHandle[1])).toBe(0)
    expect(first.outHandle).toEqual([5, 0])
  })

  it('keeps a fully degenerate knot as a corner', () => {
    const path: MaskVertex[] = [
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1, 1], inHandle: [0, 0], outHandle: [0, 0] },
    ]

    expect(convertVertexToBezier(path, 0)[0]).toMatchObject({
      inHandle: [0, 0],
      outHandle: [0, 0],
      tangentMode: 'corner',
    })
  })
})
