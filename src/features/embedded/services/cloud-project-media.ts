import { createLogger } from '@/shared/logging/logger'
import type { ProjectTimeline } from '@/types/project'
import { mediaLibraryService } from '../deps/media-library-contract'

const log = createLogger('embedded-cloud-project-media')

/** How many media an open fetches at once. */
const FETCH_CONCURRENCY = 4
/** How long a fetch may take to answer (its headers). */
const FIRST_BYTE_MS = 60_000
/** How long one file may take, body included. */
const FILE_MS = 10 * 60_000
/** The largest file an open downloads. */
const MAX_BYTES = 4 * 1024 ** 3

/** One media item of a saved project, and where the editor fetches it. */
export interface OpenMedia {
  readonly mediaId: string
  readonly ref: string
  readonly url: string
  readonly name: string
  readonly type: string
}

/** The media list of an open: the well-formed entries, and the media ids of the others. */
export function readMedia(media: unknown): { entries: OpenMedia[]; malformed: string[] } {
  const entries: OpenMedia[] = []
  const malformed: string[] = []
  for (const entry of Array.isArray(media) ? media : []) {
    const fields = (entry ?? {}) as Record<string, unknown>
    if (typeof fields.mediaId !== 'string' || !fields.mediaId) continue
    const wellFormed = ['ref', 'url', 'name', 'type'].every((k) => typeof fields[k] === 'string')
    if (wellFormed) entries.push(fields as unknown as OpenMedia)
    else malformed.push(fields.mediaId)
  }
  return { entries, malformed }
}

/** An address the editor fetches: https, or plain http on this machine for development. */
function fetchable(address: string): boolean {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
}

/** An open's media import ran out of local storage: the open fails. */
export class StorageFull extends Error {
  constructor(cause: unknown) {
    super('There is not enough storage for the media', { cause })
  }
}

/**
 * Whether an error (or what caused it) is the browser's storage running out:
 * the media library's own check before it writes, or the write refused.
 */
export function isStorageFull(error: unknown): boolean {
  for (let at: unknown = error, depth = 0; at && depth < 5; depth++) {
    if (at instanceof StorageFull) return true
    if ((at as { name?: unknown }).name === 'QuotaExceededError') return true
    if (at instanceof Error && /insufficient storage/i.test(at.message)) return true
    at = (at as { cause?: unknown }).cause
  }
  return false
}

/**
 * Fetches one file, giving up (by throwing) when it is slow, too large or
 * refused, or when `signal` aborts.
 */
async function fetchFile(entry: OpenMedia, signal: AbortSignal): Promise<Blob> {
  if (!fetchable(entry.url)) throw new Error('Not an address the editor fetches')
  signal.throwIfAborted()
  const controller = new AbortController()
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('Fetch stopped')))
  })
  aborted.catch(() => {})
  const stop = () => controller.abort()
  signal.addEventListener('abort', stop, { once: true })
  const firstByte = setTimeout(stop, FIRST_BYTE_MS)
  const whole = setTimeout(stop, FILE_MS)
  try {
    const response = await Promise.race([
      fetch(entry.url, { credentials: 'omit', signal: controller.signal }),
      aborted,
    ])
    clearTimeout(firstByte)
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
      throw new Error('The file is too large')
    }
    const fetched = await Promise.race([response.blob(), aborted])
    return new Blob([fetched], { type: entry.type || fetched.type })
  } finally {
    signal.removeEventListener('abort', stop)
    clearTimeout(firstByte)
    clearTimeout(whole)
    controller.abort()
  }
}

/** Runs `run` on every entry, at most `limit` at a time, taking no new one once `signal` aborts. */
async function eachLimited<T>(
  entries: readonly T[],
  limit: number,
  signal: AbortSignal,
  run: (entry: T) => Promise<void>,
) {
  let next = 0
  const worker = async () => {
    while (next < entries.length && !signal.aborted) await run(entries[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker))
}

interface ImportOptions {
  /** Stops the import: no new file starts, and running fetches are aborted. */
  readonly signal?: AbortSignal
  /** Called each time one file has settled, arrived or missing. */
  readonly onSettled?: () => void
}

/**
 * Fetches and imports each media item into the project, 4 at a time; a file
 * that fails to arrive never stops the others. Answers the new media id of
 * each saved one that arrived, and the parent's ref of each new media id.
 * Throws StorageFull when the browser's storage runs out (the other files are
 * stopped), and the signal's reason when it aborts; either way only once every
 * import already running has ended, so none lands after the caller cleans up.
 */
export async function importMedia(
  media: readonly OpenMedia[],
  projectId: string,
  { signal, onSettled }: ImportOptions = {},
) {
  const imported = new Map<string, string>()
  const refs: Array<{ ref: string; mediaId: string }> = []
  const stop = new AbortController()
  const abort = () => stop.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  let full: unknown = null
  try {
    await eachLimited(media, FETCH_CONCURRENCY, stop.signal, async (entry) => {
      try {
        const blob = await fetchFile(entry, stop.signal)
        stop.signal.throwIfAborted()
        const { id } = await mediaLibraryService.importMediaBlob(blob, projectId, entry.name)
        imported.set(entry.mediaId, id)
        if (entry.ref) refs.push({ ref: entry.ref, mediaId: id })
      } catch (e) {
        if (isStorageFull(e)) {
          full ??= e
          stop.abort(e)
          return
        }
        if (stop.signal.aborted) return
        log.warn(`NODARO_OPEN_PROJECT: could not bring in ${entry.name}`, { error: e })
      }
      if (!stop.signal.aborted) onSettled?.()
    })
  } finally {
    signal?.removeEventListener('abort', abort)
  }
  if (full) throw new StorageFull(full)
  signal?.throwIfAborted()
  return { imported, refs }
}

type TimelineItem = ProjectTimeline['items'][number]

/** The item fields holding an object that names a media id. */
const MEDIA_SOURCE_FIELDS = ['captionSource', 'transcriptCaptions', 'source'] as const

/**
 * Points each item at its imported media. An item whose media did not arrive
 * keeps its saved id, and that id is added to `missing`.
 */
function remapItems(
  items: readonly TimelineItem[] | undefined,
  imported: ReadonlyMap<string, string>,
  missing: Set<string>,
): TimelineItem[] {
  return (items ?? []).map((item) => {
    let next: Record<string, unknown> = item
    if (item.mediaId) {
      const mediaId = imported.get(item.mediaId)
      if (mediaId) next = { ...next, mediaId, src: undefined, thumbnailUrl: undefined }
      else missing.add(item.mediaId)
    }
    // What else on an item names its media: the clip captions came from, the
    // transcript captions follow, the media a subtitle segment was read from.
    for (const field of MEDIA_SOURCE_FIELDS) {
      const source = next[field] as { mediaId?: unknown } | undefined
      if (typeof source?.mediaId !== 'string' || !source.mediaId) continue
      const mediaId = imported.get(source.mediaId)
      if (mediaId) next = { ...next, [field]: { ...source, mediaId } }
      else missing.add(source.mediaId)
    }
    return next as TimelineItem
  })
}

/** The timeline with every item, in the main timeline and each sub-composition, remapped. */
export function remapTimeline(
  timeline: ProjectTimeline,
  imported: ReadonlyMap<string, string>,
  missing: Set<string>,
): ProjectTimeline {
  return {
    ...timeline,
    items: remapItems(timeline.items, imported, missing),
    ...(timeline.compositions && {
      compositions: timeline.compositions.map((composition) => ({
        ...composition,
        items: remapItems(composition.items, imported, missing),
      })),
    }),
  }
}
