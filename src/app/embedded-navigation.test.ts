import { describe, expect, it, vi } from 'vitest'

// A router like the app's, on a memory history: the embedded editor's
// navigations must never add an entry, because an iframe's entries join the
// framing page's session history (its Back button would switch projects).
vi.mock('@/app/router', async () => {
  const { createMemoryHistory, createRootRoute, createRoute, createRouter } =
    await import('@tanstack/react-router')
  const rootRoute = createRootRoute()
  const editor = createRoute({ getParentRoute: () => rootRoute, path: '/editor/$projectId' })
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/' })
  const routeTree = rootRoute.addChildren([index, editor])
  const history = createMemoryHistory({ initialEntries: ['/'] })
  return { router: createRouter({ routeTree, history }) }
})

import { router } from '@/app/router'
import { embeddedNavigation } from './embedded-navigation'

describe('the embedded editor navigates without adding history entries', () => {
  it('opening a project over an open project, and going back, leave the history length unchanged', async () => {
    const { openEditor, saveLocation } = embeddedNavigation()
    const { history } = router
    const start = history.length

    openEditor('A')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/editor/A'))
    const goBack = saveLocation()
    openEditor('B')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/editor/B'))
    expect(history.length).toBe(start)

    goBack()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/editor/A'))
    expect(history.length).toBe(start)
  })
})
