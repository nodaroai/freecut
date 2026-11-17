/** Readers for NODARO_PRESENCE values: whatever a parent sends, only these shapes reach the overlay. */

// A color a parent may give: hex, rgb()/rgba() or hsl()/hsla(). Nothing else reaches a style.
const COLOR =
  /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d[\d\s.,%]*\)|hsla?\(\s*\d[\d\s.,%deg]*\))$/i

export const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined

export const frame = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined

export const fraction = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined

export const color = (value: unknown): string | undefined =>
  typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : undefined

/** A target name, such as `tool.razor` or `timeline.item:<id>`. */
export const targetName = (value: unknown): string | undefined => text(value, 200)
