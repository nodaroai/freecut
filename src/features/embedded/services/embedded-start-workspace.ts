import { useEditorStore } from '../deps/studio-contract'

/**
 * Inside a host the editor always opens on the Edit workspace. The editor
 * remembers the last workspace a person used (Color, Motion) and reopens on
 * it, which on a host page read as the editor opening on the wrong page, and
 * the studio layout is laid out for Edit only.
 */
export function openOnEditWorkspace(): void {
  const state = useEditorStore.getState()
  if (state.workspace !== 'edit') state.setWorkspace('edit')
}
