/**
 * Word-by-word caption cues: one caption, shown whole, split into one cue per
 * spoken word, with that word wrapped in `<font color>` so it lights up in
 * place while the rest of the caption stays as it is.
 */

export interface CaptionWord {
  readonly text: string
  readonly start: number
  readonly end: number
}

export interface TimedText {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** Where each word sits in the caption's text, searched in order; null when it is not there. */
function locateWords(text: string, words: readonly CaptionWord[]): Array<[number, number] | null> {
  const lower = text.toLowerCase()
  let cursor = 0
  return words.map((word) => {
    const needle = word.text.trim().toLowerCase()
    const at = needle ? lower.indexOf(needle, cursor) : -1
    if (at < 0) return null
    cursor = at + needle.length
    return [at, needle.length]
  })
}

function highlighted(text: string, place: [number, number] | null, color: string): string {
  if (!place) return text
  const [at, length] = place
  return `${text.slice(0, at)}<font color="${color}">${text.slice(at, at + length)}</font>${text.slice(at + length)}`
}

/**
 * The caption's cues, in media seconds: the caption without a highlight until
 * its first word, then one cue per word lasting until the next word starts
 * (the last until the caption ends), so the caption never blinks between words.
 * Words are clamped to the caption; a word the text does not contain shows the
 * caption without a highlight.
 */
export function wordHighlightCues(
  caption: TimedText,
  words: readonly CaptionWord[],
  color: string,
): TimedText[] {
  const inside = words
    .map((word) => ({ ...word, start: Math.max(word.start, caption.start) }))
    .filter((word) => word.start < caption.end && word.end > caption.start)
    .toSorted((a, b) => a.start - b.start)
  if (inside.length === 0) return [caption]

  const places = locateWords(caption.text, inside)
  const lead =
    inside[0]!.start > caption.start
      ? [{ text: caption.text, start: caption.start, end: inside[0]!.start }]
      : []
  const windows = inside.map((word, index) => ({
    text: highlighted(caption.text, places[index] ?? null, color),
    start: word.start,
    end: inside[index + 1]?.start ?? caption.end,
  }))
  return [...lead, ...windows].filter((cue) => cue.end > cue.start)
}
