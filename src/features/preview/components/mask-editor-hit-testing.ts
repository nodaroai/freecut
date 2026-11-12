import type { MaskVertex } from '@/types/masks'
import { cubicPointAt, distanceToLineSegment, isPointInPolygon } from './mask-editor-overlay-utils'

export type PenHit = {
  type: 'vertex' | 'inHandle' | 'outHandle'
  index: number
}

export type MaskHit = PenHit | { type: 'segment'; index: number } | { type: 'shape' }

type VertexToScreen = (vertex: MaskVertex) => [number, number]
type HandleToScreen = (vertex: MaskVertex, handleType: 'in' | 'out') => [number, number]

interface HitTestMaskVerticesOptions {
  vertices: MaskVertex[]
  screenX: number
  screenY: number
  hitRadius: number
  curveHitTestSteps: number
  vertexToScreen: VertexToScreen
  handleToScreen: HandleToScreen
  closed?: boolean
}

function hitTestHandles(
  vertices: MaskVertex[],
  screenX: number,
  screenY: number,
  hitRadius: number,
  handleToScreen: HandleToScreen,
): PenHit | null {
  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index]!
    if (vertex.inHandle[0] !== 0 || vertex.inHandle[1] !== 0) {
      const [handleX, handleY] = handleToScreen(vertex, 'in')
      if (Math.hypot(screenX - handleX, screenY - handleY) < hitRadius) {
        return { type: 'inHandle', index }
      }
    }
    if (vertex.outHandle[0] !== 0 || vertex.outHandle[1] !== 0) {
      const [handleX, handleY] = handleToScreen(vertex, 'out')
      if (Math.hypot(screenX - handleX, screenY - handleY) < hitRadius) {
        return { type: 'outHandle', index }
      }
    }
  }
  return null
}

function hitTestVertexPoints(
  vertices: MaskVertex[],
  screenX: number,
  screenY: number,
  hitRadius: number,
  vertexToScreen: VertexToScreen,
): PenHit | null {
  for (let index = 0; index < vertices.length; index++) {
    const [vertexX, vertexY] = vertexToScreen(vertices[index]!)
    if (Math.hypot(screenX - vertexX, screenY - vertexY) < hitRadius) {
      return { type: 'vertex', index }
    }
  }
  return null
}

function isPointNearPathSegment(
  current: MaskVertex,
  next: MaskVertex,
  screenX: number,
  screenY: number,
  hitRadius: number,
  curveHitTestSteps: number,
  vertexToScreen: VertexToScreen,
  handleToScreen: HandleToScreen,
): boolean {
  const [startX, startY] = vertexToScreen(current)
  const [endX, endY] = vertexToScreen(next)
  const isStraight =
    current.outHandle[0] === 0 &&
    current.outHandle[1] === 0 &&
    next.inHandle[0] === 0 &&
    next.inHandle[1] === 0
  if (isStraight) {
    return distanceToLineSegment(screenX, screenY, startX, startY, endX, endY) < hitRadius
  }

  const [control1X, control1Y] = handleToScreen(current, 'out')
  const [control2X, control2Y] = handleToScreen(next, 'in')
  let previousX = startX
  let previousY = startY
  for (let step = 1; step <= curveHitTestSteps; step++) {
    const progress = step / curveHitTestSteps
    const curveX = cubicPointAt(startX, control1X, control2X, endX, progress)
    const curveY = cubicPointAt(startY, control1Y, control2Y, endY, progress)
    if (
      distanceToLineSegment(
        screenX,
        screenY,
        previousX,
        previousY,
        curveX,
        curveY,
      ) < hitRadius
    ) {
      return true
    }
    previousX = curveX
    previousY = curveY
  }
  return false
}

function hitTestPathSegments(
  vertices: MaskVertex[],
  closed: boolean,
  screenX: number,
  screenY: number,
  hitRadius: number,
  curveHitTestSteps: number,
  vertexToScreen: VertexToScreen,
  handleToScreen: HandleToScreen,
): MaskHit | null {
  const segmentCount = closed ? vertices.length : Math.max(0, vertices.length - 1)
  for (let index = 0; index < segmentCount; index++) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    if (
      isPointNearPathSegment(
        current,
        next,
        screenX,
        screenY,
        hitRadius,
        curveHitTestSteps,
        vertexToScreen,
        handleToScreen,
      )
    ) {
      return { type: 'segment', index }
    }
  }
  return null
}

function buildMaskPolygon(
  vertices: MaskVertex[],
  curveHitTestSteps: number,
  vertexToScreen: VertexToScreen,
  handleToScreen: HandleToScreen,
): [number, number][] {
  const polygon: [number, number][] = [vertexToScreen(vertices[0]!)]
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    const [startX, startY] = vertexToScreen(current)
    const [endX, endY] = vertexToScreen(next)
    const isStraight =
      current.outHandle[0] === 0 &&
      current.outHandle[1] === 0 &&
      next.inHandle[0] === 0 &&
      next.inHandle[1] === 0
    if (isStraight) {
      polygon.push([endX, endY])
      continue
    }

    const [control1X, control1Y] = handleToScreen(current, 'out')
    const [control2X, control2Y] = handleToScreen(next, 'in')
    for (let step = 1; step <= curveHitTestSteps; step++) {
      const progress = step / curveHitTestSteps
      polygon.push([
        cubicPointAt(startX, control1X, control2X, endX, progress),
        cubicPointAt(startY, control1Y, control2Y, endY, progress),
      ])
    }
  }
  return polygon
}

export function hitTestMaskVertices({
  vertices,
  screenX,
  screenY,
  hitRadius,
  curveHitTestSteps,
  vertexToScreen,
  handleToScreen,
  closed = true,
}: HitTestMaskVerticesOptions): MaskHit | null {
  const handleHit = hitTestHandles(vertices, screenX, screenY, hitRadius, handleToScreen)
  if (handleHit) return handleHit

  const vertexHit = hitTestVertexPoints(vertices, screenX, screenY, hitRadius, vertexToScreen)
  if (vertexHit) return vertexHit

  const segmentHit = hitTestPathSegments(
    vertices,
    closed,
    screenX,
    screenY,
    hitRadius,
    curveHitTestSteps,
    vertexToScreen,
    handleToScreen,
  )
  if (segmentHit) return segmentHit

  if (
    closed &&
    vertices.length >= 3 &&
    isPointInPolygon(
      screenX,
      screenY,
      buildMaskPolygon(vertices, curveHitTestSteps, vertexToScreen, handleToScreen),
    )
  ) {
    return { type: 'shape' }
  }
  return null
}

interface HitTestPenVerticesOptions {
  vertices: MaskVertex[]
  screenX: number
  screenY: number
  hitRadius: number
  vertexToScreen: VertexToScreen
  handleToScreen: HandleToScreen
}

export function hitTestPenVertices({
  vertices,
  screenX,
  screenY,
  hitRadius,
  vertexToScreen,
  handleToScreen,
}: HitTestPenVerticesOptions): PenHit | null {
  return (
    hitTestHandles(vertices, screenX, screenY, hitRadius, handleToScreen) ??
    hitTestVertexPoints(vertices, screenX, screenY, hitRadius, vertexToScreen)
  )
}
