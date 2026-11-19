import { useMemo } from 'react'
import { usePresenceStore } from '../../stores/presence-store'
import { useStudioStore } from '../../stores/studio-store'
import { postToParent, pressHostButton } from '../../services/studio-message'
import { CHARACTER_KEYFRAMES, PresenceCharacter } from '../presence-character'
import { crewOf, isLive } from './studio-crew'
import { studioWord } from './studio-strings'

/** The brand at the start of the top bar. */
export function StudioBrand() {
  return (
    <div className="nodaro-studio-brand">
      <span aria-hidden="true" className="nodaro-studio-brand-mark" />
      <span className="nodaro-studio-brand-name">NodarCut</span>
      <span className="nodaro-studio-brand-ai">AI</span>
    </div>
  )
}

function action(name: 'toggle-side' | 'close' | 'new-project') {
  postToParent('FREECUT_STUDIO_ACTION', { action: name })
}

/**
 * The crew, how many are at it, and the parent's buttons (its own, then the
 * side-panel toggle, new project and close), before the bar's own.
 */
export function StudioCrewBar() {
  const cursors = usePresenceStore((s) => s.cursors)
  const crew = useMemo(() => crewOf(cursors), [cursors])
  const sideOpen = useStudioStore((s) => s.sideOpen)
  const sideLabel = useStudioStore((s) => s.sideLabel)
  const hostButtons = useStudioStore((s) => s.hostButtons)
  const live = crew.filter(isLive).length
  return (
    <div className="nodaro-studio-crewbar">
      <style>{CHARACTER_KEYFRAMES}</style>
      {crew.length > 0 && (
        <div className="nodaro-studio-crew" aria-label={studioWord('crew')}>
          {crew.map((member) => (
            <span key={member.id} title={member.name} className="nodaro-studio-crew-face">
              <PresenceCharacter color={member.color} mood={member.mood} walking={false} home />
            </span>
          ))}
        </div>
      )}
      {live > 0 && (
        <span className="nodaro-studio-live">
          <span aria-hidden="true" className="nodaro-studio-live-dot" />
          {live === 1 ? studioWord('agentLive') : studioWord('agentsLive', live)}
        </span>
      )}
      {hostButtons.map((button) => (
        <button
          key={button.id}
          type="button"
          className="nodaro-studio-host-button"
          data-host-button={button.id}
          onClick={(event) => pressHostButton(button.id, event.currentTarget)}
        >
          {button.label}
        </button>
      ))}
      {sideLabel && (
        <button
          type="button"
          className="nodaro-studio-ai-button"
          aria-pressed={sideOpen}
          onClick={() => action('toggle-side')}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M7 1l1.4 3.6L12 6l-3.6 1.4L7 11 5.6 7.4 2 6l3.6-1.4zM11.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"
              fill="currentColor"
            />
          </svg>
          {sideLabel}
        </button>
      )}
      <button
        type="button"
        className="nodaro-studio-icon-button"
        title={studioWord('newProject')}
        aria-label={studioWord('newProject')}
        onClick={() => action('new-project')}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.5 2.5v3h-3" />
        </svg>
      </button>
      <button
        type="button"
        className="nodaro-studio-icon-button"
        title={studioWord('close')}
        aria-label={studioWord('close')}
        onClick={() => action('close')}
      >
        <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  )
}
