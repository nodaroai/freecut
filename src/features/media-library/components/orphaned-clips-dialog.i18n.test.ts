import { describe, expect, it } from 'vitest'
import type { OrphanedClipInfo } from '../types'

// The Missing media dialog names each clip by its type
// (`media.orphanedClips.clipMediaDeleted.<itemType>`): every language the
// editor ships says it, so no raw key shows.
const dictionaries = import.meta.glob<{ media: { orphanedClips: Record<string, unknown> } }>(
  '../../../i18n/locales/partials/*/media.json',
  { eager: true, import: 'default' },
)
const ITEM_TYPES: ReadonlyArray<OrphanedClipInfo['itemType']> = ['video', 'audio', 'image']

describe('Missing media dialog strings', () => {
  it('finds the dictionaries', () => {
    expect(Object.keys(dictionaries).length).toBeGreaterThanOrEqual(9)
  })

  it.each(Object.entries(dictionaries))('%s names every clip type', (_path, dictionary) => {
    const names = dictionary.media.orphanedClips.clipMediaDeleted as Record<string, unknown>
    for (const type of ITEM_TYPES) {
      expect(typeof names?.[type]).toBe('string')
      expect((names[type] as string).length).toBeGreaterThan(0)
    }
  })
})
