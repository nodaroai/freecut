import { afterEach, describe, expect, it, vi } from 'vitest'

import { initEmbeddedMessageHandler } from './embedded-message-handler'
import type { EditOpEngine } from './edit-ops-bridge'

/** The capabilities FREECUT_READY announced on the last start. */
function announced(post: { mock: { calls: unknown[][] } }): string[] {
  const ready = post.mock.calls
    .map((call) => call[0] as { type?: string; capabilities?: string[] })
    .filter((message) => message.type === 'FREECUT_READY')
    .at(-1)
  return ready?.capabilities ?? []
}

let post: { mock: { calls: unknown[][] }; mockRestore: () => void }
afterEach(() => post.mockRestore())

describe('FREECUT_READY capabilities', () => {
  it('announces the edit operations and caption highlighting with an operations engine', () => {
    post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    const engine: EditOpEngine = { prepare: async (op) => op, apply: () => null }
    initEmbeddedMessageHandler({ openEditor: vi.fn(), loadEditOps: async () => engine })

    expect(announced(post)).toEqual(
      expect.arrayContaining(['edit-ops', 'edit-ops-2', 'captions-word-highlight']),
    )
  })

  it('announces none of them without one', () => {
    post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    initEmbeddedMessageHandler({ openEditor: vi.fn() })

    const capabilities = announced(post)
    expect(capabilities).toContain('timeline-read')
    expect(capabilities).not.toContain('edit-ops')
    expect(capabilities).not.toContain('edit-ops-2')
    expect(capabilities).not.toContain('captions-word-highlight')
  })
})
