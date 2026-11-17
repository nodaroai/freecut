import { describe, expect, it } from 'vitest'
import { placeHosts, type StudioHostName } from './studio-hosts'

function hostsFor(doc: Document): Record<StudioHostName, HTMLElement> {
  const names: StudioHostName[] = [
    'brand',
    'crew',
    'monitor',
    'scopes',
    'side',
    'timecode',
    'status',
  ]
  return Object.fromEntries(
    names.map((name) => {
      const el = doc.createElement('div')
      el.dataset.studioHost = name
      return [name, el]
    }),
  ) as unknown as Record<StudioHostName, HTMLElement>
}

describe('where the studio puts its panels', () => {
  it('finds each place by what the editor already renders', () => {
    document.body.innerHTML = `
      <div role="application">
        <div><div role="toolbar"><div id="left"></div><div id="center"></div><div id="right"></div></div></div>
        <div id="row"><div id="media"></div><div data-editor-pane="preview"></div><div id="props"></div></div>
        <div data-editor-pane="timeline"><div id="tbar"><span id="label"></span><span id="tools"></span></div></div>
      </div>`
    const hosts = hostsFor(document)
    placeHosts(hosts)
    const ids = (el: Element) =>
      [...el.children].map(
        (c) => c.id || (c as HTMLElement).dataset.studioHost || c.getAttribute('data-editor-pane'),
      )
    expect(ids(document.querySelector('[role="toolbar"]')!)).toEqual([
      'brand',
      'left',
      'center',
      'crew',
      'right',
    ])
    expect(ids(document.getElementById('row')!)).toEqual([
      'media',
      'monitor',
      'preview',
      'scopes',
      'props',
      'side',
    ])
    expect(ids(document.getElementById('tbar')!)).toEqual(['label', 'timecode', 'tools'])
    expect(hosts.status.parentElement?.getAttribute('role')).toBe('application')
  })

  it('takes a panel out when its place is gone, and puts it back once it returns', () => {
    document.body.innerHTML = `<div role="application"></div>`
    const hosts = hostsFor(document)
    placeHosts(hosts)
    expect(hosts.monitor.isConnected).toBe(false)
    document.querySelector('[role="application"]')!.innerHTML =
      '<div id="row"><div data-editor-pane="preview"></div></div>'
    placeHosts(hosts)
    expect(hosts.monitor.parentElement?.id).toBe('row')
  })
})
