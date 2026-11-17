import { describe, expect, it } from 'vitest'
import {
  handleActivity,
  newLines,
  readActivityLines,
  useActivityLog,
  watchActivity,
} from './activity-log'
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
    useActivityLog.setState({ entries: [], fed: false })
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

describe('lines the parent writes', () => {
  it('reads each line and refuses what is not one', () => {
    expect(
      readActivityLines({
        lines: [
          { agent: 'Echo', color: '#ff8fc0', text: 'Heard 71 words' },
          { agent: 'Bass', color: 'red; background:url(x)', text: 'Music under the voice' },
          { agent: '', color: '#fff', text: 'no one said this' },
          'not a line',
        ],
      }),
    ).toEqual([
      { agent: 'Echo', color: '#ff8fc0', text: 'Heard 71 words' },
      { agent: 'Bass', color: '#a3a3b8', text: 'Music under the voice' },
    ])
    expect(readActivityLines(null)).toEqual([])
  })

  it('takes over the log from the cursors once the parent writes it', () => {
    useActivityLog.setState({ entries: [], fed: false })
    const stop = watchActivity(() => 5)
    const lines = [{ agent: 'Inky', color: '#f5b942', text: 'Two titles' }]
    handleActivity(new MessageEvent('message', { data: { payload: { lines } } }), () => 5)
    usePresenceStore.getState().setPresence([cursor('snip', 'a note the parent also logged')], [])
    stop()
    expect(useActivityLog.getState().entries.map((e) => e.text)).toEqual(['Two titles'])
  })
})
