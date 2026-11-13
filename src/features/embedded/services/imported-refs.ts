/**
 * The media id each parent `ref` was imported as (NODARO_IMPORT_FILES). It is a
 * promise while the import is still running, so a request that names the ref
 * right after the hand-off waits for it rather than missing it.
 */
const importedByRef = new Map<string, Promise<string | null>>()

/** How long a request waits for a ref's import before treating the ref as unknown. */
const IMPORT_WAIT_MS = 120_000

/** Settles one claimed ref with the media id it was imported as, or null when the import failed. */
export type SettleImportedRef = (mediaId: string | null) => void

/** Claim a ref before its (async) import starts, and answer how to settle it. */
export function claimImportedRef(ref: string): SettleImportedRef {
  let settle: SettleImportedRef = () => {}
  importedByRef.set(
    ref,
    new Promise((resolve) => {
      settle = resolve
    }),
  )
  return settle
}

/**
 * The media id a ref was imported as: null when the ref is unknown, its import
 * failed, or the import has not finished after a while.
 */
export async function mediaIdForRef(ref: string, waitMs = IMPORT_WAIT_MS): Promise<string | null> {
  const pending = importedByRef.get(ref)
  if (!pending) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs)
  })
  try {
    return (await Promise.race([pending, timeout])) ?? null
  } finally {
    clearTimeout(timer)
  }
}
