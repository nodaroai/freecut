import { useEffect, useMemo } from 'react'
import { useItemsStore, usePlaybackStore, useProjectStore } from '../../deps/studio-contract'
import { usePresenceStore } from '../../stores/presence-store'
import { useStudioStore } from '../../stores/studio-store'
import { useActivityLog } from './activity-log'
import { crewOf, isLive } from './studio-crew'
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
  const live = useCrew().filter(isLive).length
  const latest = useActivityLog((st) => st.entries.at(-1))
  // While agents work the whole editor says so (the stylesheet lights it up).
  useEffect(() => {
    const root = document.documentElement
    if (live > 0) root.dataset.nodaroLive = ''
    else delete root.dataset.nodaroLive
    return () => {
      delete root.dataset.nodaroLive
    }
  }, [live])
  return (
    <div className="nodaro-studio-timecode">
      <span className="nodaro-studio-timecode-now">{timecode(frame, fps)}</span>
      {live > 0 && (
        <span className="nodaro-studio-editing" role="status">
          <span aria-hidden="true" className="nodaro-studio-live-dot" />
          {studioWord('agentsAt')}
          {latest && (
            <span className="nodaro-studio-editing-now">
              <span style={{ color: latest.color }}>{latest.agent}</span> {latest.text}
            </span>
          )}
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
  const live = crew.filter(isLive).length
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
