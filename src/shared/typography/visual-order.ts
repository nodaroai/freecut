/**
 * The order a line's characters are drawn in, left to right, when the line
 * holds right-to-left text (Hebrew, Arabic).
 *
 * Text drawn as one string is put in order by the browser. Text drawn one
 * character at a time (per-glyph motion, per-run color, the GPU glyph atlas)
 * is not: walking the string and advancing to the right draws Hebrew
 * backwards. Those paths walk `visualOrder(text)` instead: the same code
 * points, in the order they sit on the line, each still known by its place in
 * the string, so its color and its motion unit are unchanged.
 *
 * A small, practical form of the Unicode bidirectional algorithm: strong
 * left-to-right and right-to-left letters, numbers (with the signs written
 * with them, like 37% and $2), neutrals resolved by their neighbours or the
 * line's direction, and paired brackets mirrored inside right-to-left text.
 * Explicit direction marks and embeddings are not honoured. Arabic letters are
 * ordered but not joined, since single glyphs cannot be shaped.
 */

type Kind = 'L' | 'R' | 'N' | 'T' | 'S' | 'O'

const RTL = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/u
const DIGIT = /\p{Nd}/u
const LETTER = /\p{L}/u
/** Signs written with a number: they stay on the number's side. */
const NUMBER_SIGN = /[%$#+\-¢-¥°₪€‰−]/u
/** Separators that keep a number whole between its digits. */
const NUMBER_SEPARATOR = /[.,:/ ]/u

const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
  '«': '»',
  '»': '«',
}

function kindOf(char: string): Kind {
  if (RTL.test(char)) return 'R'
  if (DIGIT.test(char)) return 'N'
  if (LETTER.test(char)) return 'L'
  if (NUMBER_SIGN.test(char)) return 'T'
  if (NUMBER_SEPARATOR.test(char)) return 'S'
  return 'O'
}

export interface VisualOrder {
  /** Indices into the line's code points, in the order they are drawn from the left. */
  readonly order: readonly number[]
  /** The code points by their index in the string; a bracket inside right-to-left text is mirrored. */
  readonly chars: readonly string[]
}

/** Whether the text holds any right-to-left letter. */
export const hasRightToLeft = (text: string): boolean => RTL.test(text)

/** A sign beside a number, and a separator between two digits, belong to the number. */
function joinNumbers(kinds: Kind[]): void {
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'S' && kinds[i - 1] === 'N' && kinds[i + 1] === 'N') kinds[i] = 'N'
  }
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== 'T') continue
    let end = i
    while (kinds[end + 1] === 'T') end++
    const beside = kinds[i - 1] === 'N' || kinds[end + 1] === 'N'
    for (let k = i; k <= end; k++) kinds[k] = beside ? 'N' : 'O'
    i = end
  }
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'S') kinds[i] = 'O'
}

/**
 * Each code point's level: even runs left to right, odd runs right to left.
 * A neutral between two runs of the same direction joins them; any other
 * takes the line's direction. A number runs left to right, and inside
 * right-to-left text it sits one level deeper.
 */
function levelsOf(kinds: readonly Kind[], base: 0 | 1): number[] {
  const strong = (kind: Kind | undefined): 'L' | 'R' | null =>
    kind === 'R' ? 'R' : kind === 'L' ? 'L' : kind === 'N' ? (base === 1 ? 'R' : 'L') : null
  const baseStrong = base === 1 ? 'R' : 'L'
  const levels: number[] = []
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!
    if (kind === 'R') levels.push(1)
    else if (kind === 'L') levels.push(base === 1 ? 2 : 0)
    else if (kind === 'N') levels.push(base === 1 ? 2 : 0)
    else {
      let before: 'L' | 'R' | null = null
      for (let k = i - 1; k >= 0 && !before; k--) before = strong(kinds[k])
      let after: 'L' | 'R' | null = null
      for (let k = i + 1; k < kinds.length && !after; k++) after = strong(kinds[k])
      const side =
        (before ?? baseStrong) === (after ?? baseStrong) ? (before ?? baseStrong) : baseStrong
      levels.push(side === 'R' ? 1 : base === 1 ? 2 : 0)
    }
  }
  return levels
}

/** From the deepest level down to the first odd one, every run at or above the level is reversed. */
function reorder(levels: readonly number[]): number[] {
  const order = levels.map((_, i) => i)
  const highest = Math.max(0, ...levels)
  for (let level = highest; level >= 1; level--) {
    let i = 0
    while (i < order.length) {
      if (levels[order[i]!]! < level) {
        i++
        continue
      }
      let end = i
      while (end + 1 < order.length && levels[order[end + 1]!]! >= level) end++
      for (let a = i, b = end; a < b; a++, b--) {
        const held = order[a]!
        order[a] = order[b]!
        order[b] = held
      }
      i = end + 1
    }
  }
  return order
}

/**
 * The drawing order of a line that holds right-to-left text, or null when it
 * holds none (the string's own order is then the drawing order).
 */
export function visualOrder(text: string): VisualOrder | null {
  if (!hasRightToLeft(text)) return null
  const chars = Array.from(text)
  const kinds = chars.map(kindOf)
  joinNumbers(kinds)
  const first = kinds.find((kind) => kind === 'L' || kind === 'R')
  const base: 0 | 1 = first === 'L' ? 0 : 1
  const levels = levelsOf(kinds, base)
  return {
    order: reorder(levels),
    chars: chars.map((char, i) => (levels[i]! % 2 === 1 ? (MIRROR[char] ?? char) : char)),
  }
}
