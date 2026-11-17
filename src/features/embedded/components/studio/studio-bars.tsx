import { useMemo } from 'react'
import { useItemsStore, usePlaybackStore, useProjectStore } from '../../deps/studio-contract'
import { usePresenceStore } from '../../stores/presence-store'
import { useStudioStore } from '../../stores/studio-store'
import { crewOf } from './studio-crew'
import { studioWord } from './studio-strings'
import { timecode } from './timecode'

function useCrew() {
  const cursors = usePresenceStore((s) => s.cursors)
  return useMemo(() => crewOf(cursors), [cursors])
}

/** The big timecode at the start of the timeline's bar, and whether agents are at it. */
export function StudioTimecode() {
  const frame = usePlaybackStore((s) => s.currentFrame)
  const fps = useProjectStore((s) => s.currentProject?.metadata.fps ?? 30)
  const live = useCrew().filter((m) => m.mood !== 'done').length
  return (
    <div className="nodaro-studio-timecode">
      <span className="nodaro-studio-timecode-now">{timecode(frame, fps)}</span>
      {live > 0 && (
        <span className="nodaro-studio-editing">
          <span aria-hidden="true" className="nodaro-studio-live-dot" />
          {studioWord('agentsAt')}
        </span>
      )}
    </div>
  )
}

/** The line under everything: the project, its clips, the crew and the side panel. */
export function StudioStatusBar() {
  const project = useProjectStore((s) => s.currentProject?.metadata)
  const clips = useItemsStore((s) => s.items.length)
  const crew = useCrew()
  const live = crew.filter((m) => m.mood !== 'done').length
  const sideLabel = useStudioStore((s) => s.sideLabel)
  return (
    <div className="nodaro-studio-status" role="status">
      {project && (
        <span className="nodaro-studio-status-ok">
          {project.width}×{project.height} · {project.fps} fps
        </span>
      )}
      <span>{studioWord('clips', clips)}</span>
      {crew.length > 0 && <span>{studioWord('agents', crew.length)}</span>}
      <span className="nodaro-studio-status-gap" />
      {sideLabel && (
        <span className={live > 0 ? 'nodaro-studio-status-busy' : undefined}>
          {sideLabel} · {live > 0 ? studioWord('working') : studioWord('ready')}
        </span>
      )}
      <span className="nodaro-studio-status-brand">NodarCut</span>
    </div>
  )
}
