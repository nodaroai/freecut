import { describe, expect, it } from 'vitest'
import { newLines, watchActivity, useActivityLog } from './activity-log'
import { usePresenceStore } from '../../stores/presence-store'

const cursor = (id: string, note?: string) => ({ id, name: id.split('#')[0]!, color: '#f00', note })

describe('the agents activity log', () => {
  it('writes a line when an agent says something new, once', () => {
    const said = new Map([['echo', 'captions']])
    expect(newLines([cursor('echo', 'captions'), cursor('snip', 'cut a pause')], said)).toEqual([
      { agent: 'snip', name: 'snip', color: '#f00', text: 'cut a pause' },
    ])
  })

  it('treats a station character as its agent and skips silent cursors', () => {
    const said = new Map([['echo', 'waiting']])
    expect(newLines([cursor('echo#station', 'waiting'), cursor('pix')], said)).toEqual([])
  })

  it('keeps the log as presence changes', () => {
    useActivityLog.setState({ entries: [] })
    const stop = watchActivity(() => 1000)
    usePresenceStore.getState().setPresence([cursor('snip', 'cut a pause')], [])
    usePresenceStore.getState().setPresence([cursor('snip', 'cut a pause')], [])
    usePresenceStore.getState().setPresence([cursor('snip', 'tightened the start')], [])
    stop()
    expect(useActivityLog.getState().entries.map((e) => e.text)).toEqual([
      'cut a pause',
      'tightened the start',
    ])
  })
})
