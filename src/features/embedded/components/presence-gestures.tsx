import type { CSSProperties } from 'react'
import type { PresenceGesture } from '../stores/presence-store'
import type { GestureElements } from './presence-gesture-layout'

/** Keyframes the gestures play; with reduced motion they are not played at all. */
export const PRESENCE_KEYFRAMES = `
@keyframes presence-ripple {
  from { transform: translate(-50%, -50%) scale(0.25); opacity: 0.75 }
  to { transform: translate(-50%, -50%) scale(2.6); opacity: 0 }
}
@keyframes presence-outline {
  0% { opacity: 0 } 15% { opacity: 1 } 70% { opacity: 1 } 100% { opacity: 0 }
}
`

const FONT = '600 12px/1.2 "IBM Plex Sans", system-ui, sans-serif'

/** Everything a gesture draws away from its cursor starts hidden, until the overlay places it. */
const FLOATING: CSSProperties = { position: 'absolute', left: 0, top: 0, opacity: 0 }

type Register = (patch: GestureElements) => void

interface GestureProps {
  readonly gesture: PresenceGesture
  readonly color: string
  readonly reduceMotion: boolean
  readonly register: Register
}

/** What a gesture draws at its cursor, moving with it: a ripple, a dragged chip, a typing bubble. */
export function CursorGestureParts({ gesture, color, reduceMotion, register }: GestureProps) {
  if (gesture.kind === 'click') {
    return reduceMotion ? null : (
      <span
        style={{
          position: 'absolute',
          left: 3,
          top: 3,
          width: 30,
          height: 30,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          animation: 'presence-ripple 620ms ease-out forwards',
        }}
      />
    )
  }
  if (gesture.kind === 'drag') {
    return (
      <div
        ref={(chip) => register({ chip })}
        style={{
          transition: 'opacity 200ms',
          position: 'absolute',
          left: 14,
          top: -26,
          minWidth: 36,
          padding: '3px 8px',
          borderRadius: 4,
          border: `1px dashed ${color}`,
          background: `color-mix(in srgb, ${color} 30%, rgba(20,20,20,0.85))`,
          color: '#fff',
          font: FONT,
          whiteSpace: 'nowrap',
          boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
        }}
      >
        {gesture.label ?? ' '}
      </div>
    )
  }
  if (gesture.kind === 'type') {
    return (
      <div
        style={{
          position: 'absolute',
          left: 15,
          top: 44,
          width: 'max-content',
          maxWidth: 260,
          padding: '6px 9px',
          borderRadius: 6,
          background: 'rgba(20,20,20,0.92)',
          border: `1px solid ${color}`,
          color: '#fff',
          font: '400 13px/1.35 "IBM Plex Sans", system-ui, sans-serif',
          whiteSpace: 'pre-wrap',
          boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
        }}
      >
        {/* Filled in by the overlay frame by frame, as the text is typed. */}
        <span ref={(typed) => register({ typed })} />
        <span style={{ borderLeft: `2px solid ${color}`, marginLeft: 1 }} />
      </div>
    )
  }
  return null
}

/** What a gesture draws on the editor: a target outline, a selection, a lasso, a knob, a badge. */
export function GestureLayer({ gesture, color, reduceMotion, register }: GestureProps) {
  switch (gesture.kind) {
    case 'click':
      return (
        <div
          ref={(outline) => register({ outline })}
          style={{
            ...FLOATING,
            borderRadius: 4,
            boxShadow: `0 0 0 2px ${color}, 0 0 14px ${color}`,
            ...(reduceMotion ? {} : { animation: 'presence-outline 900ms ease-out forwards' }),
          }}
        />
      )
    case 'marquee':
      return (
        <div
          ref={(marquee) => register({ marquee })}
          style={{
            ...FLOATING,
            border: `1px dashed ${color}`,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
          }}
        />
      )
    case 'lasso':
      return (
        <svg ref={(lasso) => register({ lasso })} style={{ ...FLOATING, overflow: 'visible' }}>
          {/* Its points, in the preview's own pixels, are set by the overlay. */}
          <polyline
            ref={(lassoLine) => register({ lassoLine })}
            pathLength={1}
            fill={`color-mix(in srgb, ${color} 14%, transparent)`}
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeDasharray="1"
            style={{
              strokeDashoffset: reduceMotion ? 0 : 1,
              fillOpacity: 0,
              transition: 'fill-opacity 250ms',
            }}
          />
        </svg>
      )
    case 'slide':
      return (
        <div
          ref={(knob) => register({ knob })}
          style={{
            ...FLOATING,
            borderRadius: '50%',
            background: color,
            boxShadow: '0 0 0 3px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.5)',
          }}
        />
      )
    case 'progress':
      return (
        <div
          ref={(badge) => register({ badge })}
          style={{
            ...FLOATING,
            boxSizing: 'border-box',
            padding: '3px 7px',
            borderRadius: 5,
            background: 'rgba(20,20,20,0.92)',
            border: `1px solid ${color}`,
            color: '#fff',
            font: FONT,
            overflow: 'hidden',
          }}
        >
          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {gesture.label ?? `${Math.round(gesture.value * 100)}%`}
          </span>
          <div style={{ position: 'absolute', left: 0, bottom: 0, right: 0, height: 3 }}>
            <div
              ref={(bar) => register({ bar })}
              style={{ height: '100%', width: 0, background: color, transition: 'width 300ms' }}
            />
          </div>
        </div>
      )
    default:
      return null
  }
}
