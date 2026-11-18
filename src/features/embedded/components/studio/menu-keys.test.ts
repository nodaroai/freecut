import { describe, expect, it } from 'vitest'
import { keyPressOf, shortcutLabel } from './menu-keys'

describe('the menu shortcuts', () => {
  it('presses Ctrl on Windows and Cmd on a Mac for mod', () => {
    expect(keyPressOf('mod+shift+z', false)).toMatchObject({
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    })
    expect(keyPressOf('mod+z', true)).toMatchObject({ ctrlKey: false, metaKey: true })
  })

  it('knows the named keys and digits', () => {
    expect(keyPressOf('alt+2', false)).toMatchObject({ key: '2', code: 'Digit2', altKey: true })
    expect(keyPressOf('delete', false)).toMatchObject({ key: 'Delete', code: 'Delete' })
    expect(keyPressOf('mod+equal', false)).toMatchObject({ code: 'Equal' })
  })

  it('presses nothing for an unassigned binding', () => {
    expect(keyPressOf('', false)).toBeNull()
    expect(keyPressOf('f13', false)).toBeNull()
  })

  it('writes the shortcut the way each system does', () => {
    expect(shortcutLabel('mod+shift+e', false)).toBe('Ctrl+Shift+E')
    expect(shortcutLabel('mod+shift+e', true)).toBe('⌘⇧E')
  })
})
