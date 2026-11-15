/**
 * Reading an edit operation's fields. Every reader names the operation and the
 * field in its error, so a parent sees exactly which input it got wrong.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'

/** Throw an error that names the operation. */
export function fail(op: EditOp, message: string): never {
  throw new Error(`${op.op}: ${message}`)
}

export function requireString(op: EditOp, field: string): string {
  const value = op[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${op.op} requires \`${field}\``)
  }
  return value
}

export function optionalString(op: EditOp, field: string): string | undefined {
  const value = op[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(op, `\`${field}\` must be a non-empty string`)
  }
  return value.trim()
}

export function optionalNumber(op: EditOp, field: string): number | undefined {
  const value = op[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${op.op}: \`${field}\` must be a number`)
  }
  return value
}

export function requireNumber(op: EditOp, field: string): number {
  const value = optionalNumber(op, field)
  if (value === undefined) throw new Error(`${op.op} requires \`${field}\``)
  return value
}

export function optionalBoolean(op: EditOp, field: string): boolean | undefined {
  const value = op[field]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(op, `\`${field}\` must be true or false`)
  return value
}

/** A field that must be one of a few names. */
export function optionalChoice<T extends string>(
  op: EditOp,
  field: string,
  choices: readonly T[],
): T | undefined {
  const value = op[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    fail(op, `\`${field}\` must be one of ${choices.map((c) => `'${c}'`).join(', ')}`)
  }
  return value as T
}

/** A non-empty list, each entry an object. */
export function requireObjects(
  op: EditOp,
  field: string,
  shape: string,
): Array<Record<string, unknown>> {
  const value = op[field]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${op.op} requires \`${field}\`, a list of ${shape}`)
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(op, `${field}[${index}] must be ${shape}`)
    }
    return entry as Record<string, unknown>
  })
}

export interface SecondsRange {
  start: number
  end: number
}

/** A `{ start, end }` span in seconds: start ≥ 0 and end after it. */
function readRange(op: EditOp, entry: unknown, path: string): SecondsRange {
  const { start, end } = (entry ?? {}) as { start?: unknown; end?: unknown }
  if (typeof start !== 'number' || typeof end !== 'number' || !(end > start) || start < 0) {
    fail(op, `${path} needs a start and a later end, in seconds`)
  }
  return { start, end }
}

export function requireRanges(op: EditOp, field: string): SecondsRange[] {
  const value = op[field]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${op.op} requires \`${field}\`, a list of { start, end } in seconds`)
  }
  return value.map((entry, index) => readRange(op, entry, `${field}[${index}]`))
}

// A hex color, as markers and caption markup store them.
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** A whole number inside [min, max], rounded to an even value as the canvas panel does. */
export function readEvenDimension(
  op: EditOp,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(op, `\`${path}\` must be a number of pixels from ${min} to ${max}`)
  }
  const even = Math.round(value / 2) * 2
  if (even < min || even > max) {
    fail(op, `\`${path}\` must be from ${min} to ${max} pixels`)
  }
  return even
}

/** Project canvas bounds, the same the project file accepts. */
export const CANVAS_WIDTH_RANGE = { min: 320, max: 7680 } as const
export const CANVAS_HEIGHT_RANGE = { min: 240, max: 4320 } as const
