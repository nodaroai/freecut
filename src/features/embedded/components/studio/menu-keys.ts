import { resolveHotkeys, type HotkeyKey } from '@/config/hotkeys'
import { useSettingsStore } from '../../deps/studio-contract'

/** Key names a binding uses that are not the key's own letter or digit. */
const NAMED: Readonly<Record<string, { key: string; code: string }>> = {
  space: { key: ' ', code: 'Space' },
  delete: { key: 'Delete', code: 'Delete' },
  backspace: { key: 'Backspace', code: 'Backspace' },
  left: { key: 'ArrowLeft', code: 'ArrowLeft' },
  right: { key: 'ArrowRight', code: 'ArrowRight' },
  up: { key: 'ArrowUp', code: 'ArrowUp' },
  down: { key: 'ArrowDown', code: 'ArrowDown' },
  home: { key: 'Home', code: 'Home' },
  end: { key: 'End', code: 'End' },
  equal: { key: '=', code: 'Equal' },
  minus: { key: '-', code: 'Minus' },
  backslash: { key: '\\', code: 'Backslash' },
  comma: { key: ',', code: 'Comma' },
  period: { key: '.', code: 'Period' },
  bracketleft: { key: '[', code: 'BracketLeft' },
  bracketright: { key: ']', code: 'BracketRight' },
}

/**
 * The key press a binding ("mod+shift+z") stands for, so a menu item can run
 * exactly what its shortcut runs. Null for an unassigned or unknown binding.
 */
export function keyPressOf(binding: string, mac: boolean): KeyboardEventInit | null {
  const parts = binding.trim().toLowerCase().split('+').filter(Boolean)
  const last = parts.pop()
  if (!last) return null
  const mods = new Set(parts)
  let key: string
  let code: string
  if (NAMED[last]) {
    ;({ key, code } = NAMED[last])
  } else if (/^[a-z]$/.test(last)) {
    key = last
    code = `Key${last.toUpperCase()}`
  } else if (/^[0-9]$/.test(last)) {
    key = last
    code = `Digit${last}`
  } else {
    return null
  }
  const mod = mods.has('mod')
  return {
    key,
    code,
    ctrlKey: mods.has('ctrl') || (mod && !mac),
    metaKey: mods.has('meta') || (mod && mac),
    shiftKey: mods.has('shift'),
    altKey: mods.has('alt'),
    bubbles: true,
    cancelable: true,
  }
}

/** How a binding reads in a menu: "Ctrl+Shift+Z", "⌘⇧Z". */
export function shortcutLabel(binding: string, mac: boolean): string {
  const parts = binding.trim().toLowerCase().split('+').filter(Boolean)
  const words: Record<string, string> = mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl' }
  const named: Record<string, string> = {
    delete: 'Del',
    backspace: '⌫',
    equal: '=',
    minus: '-',
    backslash: '\\',
    space: 'Space',
  }
  const out = parts.map((part) => words[part] ?? named[part] ?? part.toUpperCase())
  return out.join(mac ? '' : '+')
}

export const isMac = () =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || '')

/** The binding the person has for a command now (their own, or the editor's). */
export function bindingOf(command: HotkeyKey): string {
  return resolveHotkeys(useSettingsStore.getState().hotkeyOverrides)[command] ?? ''
}

/** Run a command the way its shortcut does. False when it has no shortcut. */
export function pressCommand(command: HotkeyKey): boolean {
  const press = keyPressOf(bindingOf(command), isMac())
  if (!press) return false
  document.dispatchEvent(new KeyboardEvent('keydown', press))
  document.dispatchEvent(new KeyboardEvent('keyup', press))
  return true
}
