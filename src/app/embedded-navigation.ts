import { router } from '@/app/router'

/**
 * How the embedded editor moves between projects: opening one in the editor,
 * and remembering where the app is so a failed open can go back there.
 *
 * Every move replaces the current history entry. A framed page's entries join
 * the framing page's session history, so an added entry would let the parent's
 * Back button switch the editor to another project without the parent knowing.
 */
export function embeddedNavigation() {
  return {
    openEditor: (projectId: string) => {
      void router.navigate({ to: '/editor/$projectId', params: { projectId }, replace: true })
    },
    saveLocation: () => {
      const { href } = router.state.location
      return () => {
        void router.navigate({ href, replace: true })
      }
    },
  }
}
