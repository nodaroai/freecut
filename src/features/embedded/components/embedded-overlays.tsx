import { CompareOverlay } from './compare-overlay'
import { PresenceOverlay } from './presence-overlay'

/**
 * What a parent draws over the embedded editor: the original beside the edit
 * (NODARO_PLAYBACK `compare`) and, above it, its collaborators (NODARO_PRESENCE).
 */
export function EmbeddedOverlays() {
  return (
    <>
      <CompareOverlay />
      <PresenceOverlay />
    </>
  )
}
