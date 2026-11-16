import { describe, expect, it } from 'vite-plus/test'
import { hasRightToLeft, visualOrder } from './visual-order'

/** The line as it reads on screen from the left. */
const drawn = (text: string): string => {
  const visual = visualOrder(text)
  return visual ? visual.order.map((i) => visual.chars[i]).join('') : text
}

const reversed = (text: string) => Array.from(text).reverse().join('')

describe('visualOrder', () => {
  it('leaves left-to-right text alone', () => {
    expect(visualOrder('It changed the whole market')).toBeNull()
    expect(hasRightToLeft('37% up')).toBe(false)
  })

  it('draws Hebrew from the right', () => {
    expect(drawn('שלום עולם')).toBe(reversed('שלום עולם'))
  })

  it('keeps every code point exactly once', () => {
    const text = 'המחירים עלו ב-37% (בשנה) ב-2024'
    const visual = visualOrder(text)!
    expect([...visual.order].sort((a, b) => a - b)).toEqual(Array.from(text).map((_, i) => i))
  })

  it('keeps a number, with its sign, left to right inside Hebrew', () => {
    // Read from the right: "עלו", then "37%".
    expect(drawn('עלו 37%')).toBe(`37% ${reversed('עלו')}`)
    expect(drawn('1,000 שקל')).toBe(`${reversed('שקל')} 1,000`)
  })

  it('keeps a Latin word left to right inside Hebrew', () => {
    expect(drawn('כמו TradingView היום')).toBe(`${reversed('היום')} TradingView ${reversed('כמו')}`)
  })

  it('mirrors brackets inside Hebrew', () => {
    // Read from the right the line opens with "(": drawn from the left it closes with it.
    expect(drawn('(שלום)')).toBe(`(${reversed('שלום')})`)
  })

  it('follows the first strong letter for the direction of the line', () => {
    // A left-to-right line with a Hebrew word in it: only that word turns.
    expect(drawn('Hello שלום world')).toBe(`Hello ${reversed('שלום')} world`)
  })
})
