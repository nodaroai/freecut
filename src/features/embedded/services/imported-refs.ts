/**
 * The media id each parent `ref` was imported as (NODARO_IMPORT_FILES). It is a
 * promise while the import is still running, so a request that names the ref
 * right after the hand-off waits for it rather than missing it.
 */
const importedByRef = new Map<string, Promise<string | null>>()

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

/** The media id a ref was imported as: null when unknown or failed, after any running import. */
export async function mediaIdForRef(ref: string): Promise<string | null> {
  return (await importedByRef.get(ref)) ?? null
}
