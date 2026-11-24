import { beforeEach, describe, expect, it, vi } from 'vitest'

// The refs are module state: each test starts from a fresh module.
let refs: typeof import('./imported-refs')
beforeEach(async () => {
  vi.resetModules()
  refs = await import('./imported-refs')
})

describe('refsByMediaId', () => {
  it('maps each settled media id to its ref, and leaves out a failed import', () => {
    refs.claimImportedRef('r1')('m1')
    refs.claimImportedRef('r2')(null)
    refs.claimImportedRef('r3')

    expect(refs.refsByMediaId()).toEqual({ m1: 'r1' })
  })

  it('keeps the media of an earlier import when the same ref is imported again', () => {
    refs.claimImportedRef('r1')('m1')
    refs.claimImportedRef('r1')('m2')

    expect(refs.refsByMediaId()).toEqual({ m1: 'r1', m2: 'r1' })
  })

  it('keeps the earlier media when the second import of the ref fails', () => {
    refs.claimImportedRef('r1')('m1')
    refs.claimImportedRef('r1')(null)

    expect(refs.refsByMediaId()).toEqual({ m1: 'r1' })
  })

  it('records an older import that settles after the ref was claimed again', async () => {
    const settleOld = refs.claimImportedRef('r1')
    const settleNew = refs.claimImportedRef('r1')
    settleOld('m1')

    expect(refs.refsByMediaId()).toEqual({ m1: 'r1' })
    // The newest claim still decides what a request naming the ref gets.
    settleNew('m2')
    expect(await refs.mediaIdForRef('r1')).toBe('m2')
    expect(refs.refsByMediaId()).toEqual({ m1: 'r1', m2: 'r1' })
  })
})
