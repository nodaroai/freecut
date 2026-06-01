import { describe, expect, it } from 'vite-plus/test'
import { HOTKEYS } from '@/config/hotkeys'
import { HOTKEY_EDITOR_SECTIONS, getHotkeyEditorSearchResults } from './hotkey-editor-sections'

describe('getHotkeyEditorSearchResults', () => {
  it('filters commands by localized label', () => {
    const results = getHotkeyEditorSearchResults({
      query: 'ripple',
      sections: HOTKEY_EDITOR_SECTIONS,
      hotkeys: HOTKEYS,
      translate: (key) =>
        key.endsWith('rippleDeleteSelectedItems') ? 'Ripple delete selected items' : key,
    })

    expect(results.map((result) => result.item.labelKey)).toEqual([
      'projects.settings.hotkeys.items.rippleDeleteSelectedItems',
    ])
  })

  it('filters commands by current shortcut binding', () => {
    const results = getHotkeyEditorSearchResults({
      query: 'mod+shift+e',
      sections: HOTKEY_EDITOR_SECTIONS,
      hotkeys: HOTKEYS,
      translate: (key) => (key.endsWith('exportVideo') ? 'Export video' : key),
    })

    expect(results.map((result) => result.item.labelKey)).toEqual([
      'projects.settings.hotkeys.items.exportVideo',
    ])
  })
})
