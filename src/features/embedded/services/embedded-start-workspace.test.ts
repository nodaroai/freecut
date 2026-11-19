import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../deps/studio-contract'
import { openOnEditWorkspace } from './embedded-start-workspace'

describe('openOnEditWorkspace', () => {
  beforeEach(() => {
    localStorage.removeItem('editor:workspace')
  })

  it.each(['color', 'motion'] as const)('moves a remembered %s workspace to Edit', (workspace) => {
    useEditorStore.getState().setWorkspace(workspace)
    openOnEditWorkspace()
    expect(useEditorStore.getState().workspace).toBe('edit')
  })

  it('leaves Edit as it is', () => {
    useEditorStore.getState().setWorkspace('edit')
    openOnEditWorkspace()
    expect(useEditorStore.getState().workspace).toBe('edit')
  })
})
