import type { PresenceMood } from '../stores/presence-store'

/**
 * A collaborator drawn as a character instead of an arrow: a round body in its
 * colour with two eyes, feet and a hand. What it is doing shows on it:
 * - working (the default): eyes open, a small bob while it moves;
 * - waiting: eyes closed, "z Z" rising, a little faded;
 * - done: sunglasses and a smile;
 * - needs-you: worried brows, sweat drops, a shake and a "!".
 * The point it stands on stays exact: a small tip marks it, and the character
 * stands just beside it, so a click or a drag still lands where it points.
 */

const BODY =
  'M32 8c12.6 0 21.6 8.9 21.6 20.9C53.6 42.3 44.7 54 32 54S10.4 42.3 10.4 28.9C10.4 16.9 19.4 8 32 8z'

export const CHARACTER_KEYFRAMES = `
@keyframes nodaro-char-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
@keyframes nodaro-char-step { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2.5px) } }
@keyframes nodaro-char-blink { 0%,93%,100% { transform: scaleY(1) } 96% { transform: scaleY(0.1) } }
@keyframes nodaro-char-zz { 0% { transform: translate(0,4px); opacity: .2 } 50% { opacity: 1 } 100% { transform: translate(6px,-6px); opacity: 0 } }
@keyframes nodaro-char-drip { 0% { transform: translateY(0); opacity: 1 } 100% { transform: translateY(7px); opacity: 0 } }
@keyframes nodaro-char-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-1px) } 75% { transform: translateX(1px) } }
[data-presence-character] .nodaro-char-eyes { transform-box: fill-box; transform-origin: center; animation: nodaro-char-blink 4.2s infinite }
[data-presence-character][data-walking='true'] .nodaro-char-body { animation: nodaro-char-step 0.28s infinite }
[data-presence-character][data-mood='working'] .nodaro-char-body { animation: nodaro-char-bob 1.2s ease-in-out infinite }
[data-presence-character][data-mood='needs-you'] .nodaro-char-body { animation: nodaro-char-shake 0.25s infinite }
[data-presence-character] .nodaro-char-zz { animation: nodaro-char-zz 1.8s ease-in-out infinite }
[data-presence-character] .nodaro-char-drip { animation: nodaro-char-drip 1s ease-in infinite }
@media (prefers-reduced-motion: reduce) { [data-presence-character] * { animation: none !important } }
`

/** The tip that marks the exact point, in the character's colour. */
function Tip({ color }: { readonly color: string }) {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" style={{ position: 'absolute', left: 0, top: 0 }}>
      <path
        d="M0.5 0.5 L8.5 3.2 L3.2 8.5 Z"
        fill={color}
        stroke="rgba(0,0,0,0.7)"
        strokeWidth="0.8"
      />
    </svg>
  )
}

export function PresenceCharacter({
  color,
  mood,
  walking,
}: {
  readonly color: string
  readonly mood: PresenceMood
  readonly walking: boolean
}) {
  const asleep = mood === 'waiting'
  const done = mood === 'done'
  const worried = mood === 'needs-you'
  return (
    <div
      data-presence-character
      data-mood={mood}
      data-walking={walking ? 'true' : 'false'}
      style={{ position: 'relative', width: 56, height: 50, opacity: asleep ? 0.7 : 1 }}
    >
      <Tip color={color} />
      <svg
        className="nodaro-char-body"
        width="44"
        height="44"
        viewBox="0 0 64 64"
        style={{
          position: 'absolute',
          left: 9,
          top: 4,
          overflow: 'visible',
          filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 2px 3px rgba(0,0,0,0.5))`,
        }}
      >
        <ellipse cx="32" cy="61" rx="14" ry="2.4" fill="#000" opacity=".45" />
        <ellipse cx="25" cy="57" rx="4.6" ry="2.7" fill={color} />
        <ellipse cx="39" cy="57" rx="4.6" ry="2.7" fill={color} />
        <path d={BODY} fill={color} />
        <ellipse
          cx="22"
          cy="17"
          rx="7"
          ry="3.2"
          transform="rotate(-24 22 17)"
          fill="#fff"
          opacity=".45"
        />
        {asleep ? (
          <g stroke="#0b0b12" strokeWidth="2.4" fill="none" strokeLinecap="round">
            <path d="M21 28q4.5 3.5 9 0" />
            <path d="M34 27q4.5 3.5 9 0" />
          </g>
        ) : done ? (
          <g>
            <path d="M17 21h15v6q-7.5 6-15 0z" fill="#0b0b12" />
            <path d="M33 21h15v6q-7.5 6-15 0z" fill="#0b0b12" />
            <path d="M16 22h33" stroke="#0b0b12" strokeWidth="2.2" />
            <path d="M20 23.5h5" stroke="#fff" strokeWidth="1.6" opacity=".8" />
            <path
              d="M26 39q6 5 12 0"
              stroke="#0b0b12"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g className="nodaro-char-eyes">
            <ellipse cx="25.5" cy="27" rx="3.8" ry={worried ? 6.6 : 5.8} fill="#fff" />
            <ellipse cx="38.5" cy="26" rx="3.8" ry={worried ? 6.6 : 5.8} fill="#fff" />
            <circle cx={worried ? 25 : 27} cy={worried ? 25 : 28.5} r="1.9" fill="#0b0b12" />
            <circle cx={worried ? 38 : 40} cy={worried ? 24 : 27.5} r="1.9" fill="#0b0b12" />
          </g>
        )}
        {worried ? (
          <g>
            <path
              d="M19 19l9-3.5M45 18l-9-3.5"
              stroke="#0b0b12"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M27 41q5-4 10 0"
              stroke="#0b0b12"
              strokeWidth="2.4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              className="nodaro-char-drip"
              d="M11 17c2 3 3 4.5 3 6a3 3 0 0 1-6 0c0-1.5 1-3 3-6z"
              fill="#7dd3fc"
            />
            <path
              className="nodaro-char-drip"
              style={{ animationDelay: '0.5s' }}
              d="M54 14c2 3 3 4.5 3 6a3 3 0 0 1-6 0c0-1.5 1-3 3-6z"
              fill="#7dd3fc"
            />
          </g>
        ) : null}
        <circle
          cx={walking ? 13 : 50}
          cy={walking ? 38 : 30}
          r="3.8"
          fill={color}
          stroke="rgba(0,0,0,0.2)"
        />
      </svg>
      {asleep ? (
        <span
          className="nodaro-char-zz"
          style={{
            position: 'absolute',
            left: 44,
            top: -4,
            font: '800 10px/1 Inter, sans-serif',
            color: '#c9c9ff',
          }}
        >
          z Z
        </span>
      ) : null}
      {worried ? (
        <span
          style={{
            position: 'absolute',
            left: 42,
            top: 0,
            width: 13,
            height: 13,
            borderRadius: '50%',
            background: '#ff2d9b',
            color: '#fff',
            font: '900 10px/13px Inter, sans-serif',
            textAlign: 'center',
            boxShadow: '0 0 8px #ff2d9b',
          }}
        >
          !
        </span>
      ) : null}
    </div>
  )
}
