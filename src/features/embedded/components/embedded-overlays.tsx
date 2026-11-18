import { useEffect } from 'react'
import { CompareOverlay } from './compare-overlay'
import { watchLanes } from './lane-painter'
import { PresenceOverlay } from './presence-overlay'
import { StudioLayout } from './studio/studio-layout'

/**
 * What a parent draws over the embedded editor: the original beside the edit
 * (NODARO_PLAYBACK `compare`) and, above it, its collaborators (NODARO_PRESENCE).
 * It also marks each track with the lane its clips make (see lane-painter),
 * and lays the editor out as one studio when the parent asks (NODARO_STUDIO).
 */
export function EmbeddedOverlays() {
  useEffect(() => watchLanes(), [])
  return (
    <>
      <CompareOverlay />
      <PresenceOverlay />
      <StudioLayout />
    </>
  )
}
