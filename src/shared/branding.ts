/**
 * Brand configuration for this deployment.
 *
 * Upstream ships as "FreeCut"; every user-visible surface here is rebranded to
 * Nodaro at runtime so upstream syncs never conflict with hand-edited strings.
 * Functional identifiers (storage keys, the on-disk `FreeCutProjects` folder)
 * must keep their upstream names — the pattern below deliberately skips them.
 */

export const BRAND_NAME = 'Nodaro'

const UPSTREAM_BRAND_PATTERN = /FreeCut(?!Projects)/g

function rebrandText(text: string): string {
  return text.replace(UPSTREAM_BRAND_PATTERN, BRAND_NAME)
}

/**
 * Returns a copy of `value` with the upstream brand replaced in every string,
 * recursing through plain objects and arrays. Non-string leaves pass through.
 */
export function rebrandDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return rebrandText(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rebrandDeep(entry)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rebrandDeep(entry)]),
    ) as T
  }
  return value
}
