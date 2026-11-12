/**
 * Canvas Shape Rendering System
 *
 * Renders all shape types with full styling support for client-side export.
 * Leverages existing shape-path utilities and converts SVG paths to Path2D.
 */

import type { ShapeItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { getShapePath, rotatePath } from '@/runtime/renderer/deps/composition-runtime-contract'
import { svgPathToPath2D } from './canvas-masks'
import { createLogger } from '@/shared/logging/logger'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { getTaperStrokeSegments, hasActiveTaper } from '@/shared/graphics/shapes/taper-path'
import {
  getLinearGradientUnitEndpoints,
  resolveShapeLinearGradient,
} from '@/shared/graphics/shapes/linear-gradient'
import {
  buildTaperedOutline,
  getTaperedOutlineFillPath,
} from '@/shared/graphics/shapes/taper-outline'

const log = createLogger('CanvasShapes')

/**
 * Canvas dimensions for shape rendering
 */
interface ShapeCanvasSettings {
  width: number
  height: number
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function estimatePathShapeLength(shape: ShapeItem, width: number, height: number): number {
  return flattenBezierPath(shape.pathVertices ?? [], width, height, shape.pathClosed ?? true)
    .totalLength
}

function estimateRoundedRectanglePerimeter(
  shape: ShapeItem,
  width: number,
  height: number,
): number {
  const radius = Math.min(shape.cornerRadius ?? 0, width / 2, height / 2)
  return 2 * (width + height - 4 * radius) + 2 * Math.PI * radius
}

function estimateEllipsePerimeter(shape: ShapeItem, width: number, height: number): number {
  const aspectLocked = shape.transform?.aspectRatioLocked ?? true
  const lockedCircleSize = Math.min(width, height)
  const horizontalRadius =
    shape.shapeType === 'circle' && aspectLocked ? lockedCircleSize / 2 : width / 2
  const verticalRadius =
    shape.shapeType === 'circle' && aspectLocked ? lockedCircleSize / 2 : height / 2
  return (
    Math.PI *
    (3 * (horizontalRadius + verticalRadius) -
      Math.sqrt(
        Math.max(
          0,
          (3 * horizontalRadius + verticalRadius) * (horizontalRadius + 3 * verticalRadius),
        ),
      ))
  )
}

function estimateTrianglePerimeter(shape: ShapeItem, width: number, height: number): number {
  const aspectLocked = shape.transform?.aspectRatioLocked ?? true
  if (aspectLocked) return Math.min(width, height) * 3
  return shape.direction === 'left' || shape.direction === 'right'
    ? height + 2 * Math.hypot(width, height / 2)
    : width + 2 * Math.hypot(width / 2, height)
}

function resolveRadialPointCount(shape: ShapeItem): number {
  const defaultCount = shape.shapeType === 'star' ? 5 : shape.shapeType === 'polygon' ? 6 : 3
  return Math.max(3, Math.round(shape.points ?? defaultCount))
}

function buildRadialShapeVertices(
  shape: ShapeItem,
  width: number,
  height: number,
  count: number,
): Array<[number, number]> {
  const vertices: Array<[number, number]> = []
  const vertexCount = shape.shapeType === 'star' ? count * 2 : count
  let polygonWidth = width
  let polygonHeight = height
  if (shape.transform?.aspectRatioLocked ?? true) {
    polygonWidth = Math.min(width, height)
    polygonHeight = polygonWidth
  }
  for (let index = 0; index < vertexCount; index++) {
    const angle = (index / vertexCount) * Math.PI * 2 - Math.PI / 2
    const radius = shape.shapeType === 'star' && index % 2 === 1 ? (shape.innerRadius ?? 0.5) : 1
    vertices.push([
      Math.cos(angle) * (polygonWidth / 2) * radius,
      Math.sin(angle) * (polygonHeight / 2) * radius,
    ])
  }
  return vertices
}

function estimateRadialShapePerimeter(shape: ShapeItem, width: number, height: number): number {
  const count = resolveRadialPointCount(shape)
  const vertices = buildRadialShapeVertices(shape, width, height, count)
  return vertices.reduce(
    (sum, vertex, index) => sum + distance(vertex, vertices[(index + 1) % vertices.length]!),
    0,
  )
}

function estimateShapePerimeter(shape: ShapeItem, width: number, height: number): number {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  switch (shape.shapeType) {
    case 'path':
      return estimatePathShapeLength(shape, safeWidth, safeHeight)
    case 'rectangle':
      return estimateRoundedRectanglePerimeter(shape, safeWidth, safeHeight)
    case 'circle':
    case 'ellipse':
      return estimateEllipsePerimeter(shape, safeWidth, safeHeight)
    case 'heart':
      return Math.min(safeWidth, safeHeight) * 3.35
    case 'triangle':
      return estimateTrianglePerimeter(shape, safeWidth, safeHeight)
    default:
      return estimateRadialShapePerimeter(shape, safeWidth, safeHeight)
  }
}

function applyTrimPathStroke(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
): void {
  const start = Math.max(0, Math.min(100, shape.trimPathStart ?? 0))
  const end = Math.max(0, Math.min(100, shape.trimPathEnd ?? 100))
  if (start === 0 && end === 100) return
  const perimeter = estimateShapePerimeter(shape, transform.width, transform.height)
  if (perimeter <= 0) return
  const visiblePercent = (((end - start) % 100) + 100) % 100
  ctx.setLineDash([(visiblePercent / 100) * perimeter, ((100 - visiblePercent) / 100) * perimeter])
  ctx.lineDashOffset = -(
    (start / 100) * perimeter +
    ((shape.trimPathOffset ?? 0) / 360) * perimeter
  )
}

type RenderableShapeStroke = ShapeItem & { strokeColor: string; strokeWidth: number }

function fillCustomTaperedPath(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: RenderableShapeStroke,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): boolean {
  const vertices = shape.pathVertices
  if (shape.shapeType !== 'path' || !vertices || vertices.length < 2) return false
  const flattened = flattenBezierPath(
    vertices,
    transform.width,
    transform.height,
    shape.pathClosed !== false,
  )
  const centerX = canvas.width / 2 + transform.x
  const centerY = canvas.height / 2 + transform.y
  const left = centerX - transform.width / 2
  const top = centerY - transform.height / 2
  const radians = (transform.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const transformedPath = {
    ...flattened,
    points: flattened.points.map((point) => {
      const dx = left + point.x - centerX
      const dy = top + point.y - centerY
      return {
        x: centerX + dx * cos - dy * sin,
        y: centerY + dx * sin + dy * cos,
        progress: point.progress,
      }
    }),
  }
  const outline = buildTaperedOutline(transformedPath, { ...shape, lineCap: shape.strokeLineCap })
  if (!outline) return true
  ctx.fillStyle = shape.strokeColor
  ctx.fill(svgPathToPath2D(getTaperedOutlineFillPath(outline)))
  return true
}

function strokeTaperedPath(
  ctx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  shape: RenderableShapeStroke,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): void {
  if (fillCustomTaperedPath(ctx, shape, transform, canvas)) return

  const perimeter = estimateShapePerimeter(shape, transform.width, transform.height)
  if (perimeter <= 0) return

  const segments = getTaperStrokeSegments(shape)
  for (const segment of segments) {
    const segmentLength = (segment.length / 100) * perimeter
    ctx.setLineDash([segmentLength, Math.max(0, perimeter - segmentLength)])
    ctx.lineDashOffset = -(segment.offset / 100) * perimeter
    ctx.lineWidth = (shape.strokeWidth ?? 0) * segment.widthScale
    ctx.lineCap = 'butt'
    ctx.stroke(path)
  }
}

function hasRenderableStroke(shape: ShapeItem): shape is RenderableShapeStroke {
  return (
    (shape.strokeEnabled ?? true) &&
    typeof shape.strokeWidth === 'number' &&
    shape.strokeWidth > 0 &&
    typeof shape.strokeColor === 'string' &&
    shape.strokeColor.length > 0
  )
}

function renderShapeStroke(
  ctx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): void {
  if (!hasRenderableStroke(shape)) return

  ctx.strokeStyle = shape.strokeColor
  ctx.lineCap = shape.strokeLineCap ?? 'butt'
  ctx.lineJoin = shape.strokeLineJoin ?? 'miter'
  ctx.miterLimit = shape.strokeMiterLimit ?? 4
  if (hasActiveTaper(shape)) {
    strokeTaperedPath(ctx, path, shape, transform, canvas)
    return
  }

  ctx.lineWidth = shape.strokeWidth
  applyTrimPathStroke(ctx, shape, transform)
  ctx.stroke(path)
}

function getShapeFillStyle(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): string | CanvasGradient {
  const gradient = resolveShapeLinearGradient(shape)
  if (!gradient) return shape.fillColor

  const endpoints = getLinearGradientUnitEndpoints(gradient.angle)
  const centerX = canvas.width / 2 + transform.x
  const centerY = canvas.height / 2 + transform.y
  const left = centerX - transform.width / 2
  const top = centerY - transform.height / 2
  const radians = (transform.rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const rotateEndpoint = (endpoint: { x: number; y: number }): [number, number] => {
    const x = left + endpoint.x * transform.width
    const y = top + endpoint.y * transform.height
    const dx = x - centerX
    const dy = y - centerY
    return [centerX + dx * cos - dy * sin, centerY + dx * sin + dy * cos]
  }
  const start = rotateEndpoint(endpoints.start)
  const end = rotateEndpoint(endpoints.end)
  const canvasGradient = ctx.createLinearGradient(start[0], start[1], end[0], end[1])
  canvasGradient.addColorStop(0, gradient.startColor)
  canvasGradient.addColorStop(1, gradient.endColor)
  return canvasGradient
}

/**
 * Get a Path2D for a shape at its current transform.
 *
 * @param shape - The shape item
 * @param transform - Resolved transform (possibly animated)
 * @param canvas - Canvas dimensions
 * @returns Path2D ready for canvas rendering
 */
function getShapePath2D(
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): Path2D {
  // Use existing shape-path utility to generate SVG path
  const svgPath = getShapePath(
    shape,
    {
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: 0, // Rotation handled separately
      opacity: transform.opacity,
    },
    {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    },
  )

  // Apply rotation by baking it into the path coordinates
  let finalPath = svgPath
  if (transform.rotation !== 0) {
    const centerX = canvas.width / 2 + transform.x
    const centerY = canvas.height / 2 + transform.y
    finalPath = rotatePath(svgPath, transform.rotation, centerX, centerY)
  }

  return svgPathToPath2D(finalPath)
}

/**
 * Render a shape item to canvas.
 *
 * @param ctx - Canvas 2D context
 * @param shape - The shape item to render
 * @param transform - Resolved transform (possibly animated)
 * @param canvas - Canvas dimensions
 */
export function renderShape(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: ShapeItem,
  transform: ResolvedTransform,
  canvas: ShapeCanvasSettings,
): void {
  // Don't render masks as shapes - they're handled by the mask system
  if (shape.isMask) return

  ctx.save()

  try {
    // Get the shape path
    const path = getShapePath2D(shape, transform, canvas)

    // Apply opacity
    ctx.globalAlpha = transform.opacity

    // Fill the shape
    const fillEnabled =
      shape.shapeType === 'path' && shape.pathClosed === false ? false : (shape.fillEnabled ?? true)
    if (fillEnabled && shape.fillColor) {
      ctx.fillStyle = getShapeFillStyle(ctx, shape, transform, canvas)
      ctx.fill(path)
    }

    renderShapeStroke(ctx, path, shape, transform, canvas)

    // Apply corner radius clipping if needed
    if (transform.cornerRadius > 0) {
      // Note: Corner radius is typically baked into the shape path
      // for rectangles. For other shapes, it's handled by the shape generator.
      log.debug('Corner radius applied via shape path', {
        shapeId: shape.id,
        cornerRadius: transform.cornerRadius,
      })
    }
  } finally {
    ctx.restore()
  }
}
