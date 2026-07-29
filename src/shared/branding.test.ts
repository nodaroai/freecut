import { describe, expect, it } from 'vitest'

import { BRAND_NAME, rebrandDeep } from './branding'

describe('rebrandDeep', () => {
  it('replaces every upstream brand mention in a string', () => {
    expect(rebrandDeep('FreeCut is FreeCut')).toBe(`${BRAND_NAME} is ${BRAND_NAME}`)
  })

  it('keeps the on-disk FreeCutProjects folder name intact', () => {
    expect(rebrandDeep('FreeCut stores projects in FreeCutProjects')).toBe(
      `${BRAND_NAME} stores projects in FreeCutProjects`,
    )
  })

  it('rebrands nested objects and arrays without mutating the input', () => {
    const input = {
      title: 'How FreeCut Works',
      sections: [{ items: ['Open FreeCut', 'Pick a folder'] }],
      count: 3,
      enabled: true,
      missing: null,
    }
    const inputSnapshot = structuredClone(input)

    const result = rebrandDeep(input)

    expect(result).toEqual({
      title: `How ${BRAND_NAME} Works`,
      sections: [{ items: [`Open ${BRAND_NAME}`, 'Pick a folder'] }],
      count: 3,
      enabled: true,
      missing: null,
    })
    expect(result).not.toBe(input)
    expect(input).toEqual(inputSnapshot)
  })

  it('returns non-string primitives unchanged', () => {
    expect(rebrandDeep(42)).toBe(42)
    expect(rebrandDeep(null)).toBeNull()
    expect(rebrandDeep(undefined)).toBeUndefined()
  })
})
