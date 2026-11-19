/** A button the parent adds to the studio top bar (NODARO_STUDIO hostButtons). */
export interface StudioHostButton {
  readonly id: string
  readonly label: string
}

const MAX_HOST_BUTTONS = 3
const MAX_LABEL = 40
const ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
/** Nothing left to see once format characters (zero-width spaces and the like) and spaces go. */
const INVISIBLE = /^[\p{Cf}\s]*$/u

function parseOne(raw: unknown): StudioHostButton | null {
  if (!raw || typeof raw !== 'object') return null
  const { id, label } = raw as Record<string, unknown>
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  if (typeof label !== 'string') return null
  // Cut by code points so a cut never splits a surrogate pair.
  const text = Array.from(label.trim()).slice(0, MAX_LABEL).join('')
  return INVISIBLE.test(text) ? null : { id, label: text }
}

/**
 * The parent's own top-bar buttons: at most three, each with an id of lowercase
 * letters, digits and dashes (starting with a letter, up to 32) and a label of
 * up to 40 characters with something visible in it. Anything else, and a
 * repeated id (the first wins), is dropped; no list means no buttons.
 */
export function parseHostButtons(raw: unknown): readonly StudioHostButton[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const buttons: StudioHostButton[] = []
  for (const entry of raw) {
    const button = parseOne(entry)
    if (!button || seen.has(button.id)) continue
    seen.add(button.id)
    buttons.push(button)
    if (buttons.length === MAX_HOST_BUTTONS) break
  }
  return buttons
}
