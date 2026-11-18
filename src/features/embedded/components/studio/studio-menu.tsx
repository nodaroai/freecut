import type { HotkeyKey } from '@/config/hotkeys'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { postToParent } from '../../services/studio-message'
import { bindingOf, isMac, pressCommand, shortcutLabel } from './menu-keys'
import { menuWord, type MenuWord } from './studio-menu-strings'

type ParentAction = 'toggle-side' | 'close' | 'new-project'

/** One menu line: an editor command (run as its shortcut) or a button of the parent's. */
type Entry =
  | { readonly word: MenuWord; readonly command: HotkeyKey }
  | { readonly word: MenuWord; readonly parent: ParentAction }
  | 'separator'

interface Menu {
  readonly word: MenuWord
  readonly entries: readonly Entry[]
}

/** The menus, each line something the editor really does. */
const STUDIO_MENUS: readonly Menu[] = [
  {
    word: 'file',
    entries: [
      { word: 'save', command: 'SAVE' },
      { word: 'export', command: 'EXPORT' },
      'separator',
      { word: 'startOver', parent: 'new-project' },
      { word: 'close', parent: 'close' },
    ],
  },
  {
    word: 'edit',
    entries: [
      { word: 'undo', command: 'UNDO' },
      { word: 'redo', command: 'REDO' },
      'separator',
      { word: 'cut', command: 'CUT' },
      { word: 'copy', command: 'COPY' },
      { word: 'paste', command: 'PASTE' },
      { word: 'delete', command: 'DELETE_SELECTED' },
    ],
  },
  {
    word: 'clip',
    entries: [
      { word: 'split', command: 'SPLIT_AT_PLAYHEAD_ALT' },
      { word: 'join', command: 'JOIN_ITEMS' },
      { word: 'rippleDelete', command: 'RIPPLE_DELETE' },
      { word: 'freeze', command: 'FREEZE_FRAME' },
      'separator',
      { word: 'addMarker', command: 'ADD_MARKER' },
    ],
  },
  {
    word: 'color',
    entries: [
      { word: 'colorRoom', command: 'WORKSPACE_COLOR' },
      { word: 'editRoom', command: 'WORKSPACE_EDIT' },
      { word: 'motionRoom', command: 'WORKSPACE_ANIMATE' },
    ],
  },
  {
    word: 'captions',
    entries: [
      { word: 'searchWords', command: 'OPEN_SCENE_BROWSER' },
      { word: 'addCaptions', parent: 'toggle-side' },
    ],
  },
  {
    word: 'audio',
    entries: [
      { word: 'linkAv', command: 'LINK_AUDIO_VIDEO' },
      { word: 'unlinkAv', command: 'UNLINK_AUDIO_VIDEO' },
      { word: 'linkedSelection', command: 'TOGGLE_LINKED_SELECTION' },
    ],
  },
  {
    word: 'agents',
    entries: [{ word: 'editWithAi', parent: 'toggle-side' }],
  },
]

function run(entry: Exclude<Entry, 'separator'>) {
  if ('command' in entry) {
    // After the menu has closed and given focus back, so the shortcut lands on the editor.
    requestAnimationFrame(() => pressCommand(entry.command))
  } else {
    postToParent('FREECUT_STUDIO_ACTION', { action: entry.parent })
  }
}

function Shortcut({ command }: { command: HotkeyKey }) {
  const binding = bindingOf(command)
  if (!binding) return null
  return <span className="nodaro-studio-menu-key">{shortcutLabel(binding, isMac())}</span>
}

/** File, Edit, Clip… after the brand: each line runs the editor's own command. */
export function StudioMenuBar() {
  return (
    <nav className="nodaro-studio-menubar">
      {STUDIO_MENUS.map((menu) => (
        <DropdownMenu key={menu.word} modal={false}>
          <DropdownMenuTrigger className="nodaro-studio-menu-trigger">
            {menuWord(menu.word)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="nodaro-studio-menu">
            {menu.entries.map((entry, index) =>
              entry === 'separator' ? (
                <DropdownMenuSeparator key={`sep-${index}`} />
              ) : (
                <DropdownMenuItem key={entry.word} onSelect={() => run(entry)}>
                  <span>{menuWord(entry.word)}</span>
                  {'command' in entry && <Shortcut command={entry.command} />}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </nav>
  )
}
