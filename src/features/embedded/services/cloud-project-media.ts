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

/** Fetches one file, giving up (by throwing) when it is slow, too large or refused. */
async function fetchFile(entry: OpenMedia): Promise<Blob> {
  if (!fetchable(entry.url)) throw new Error('Not an address the editor fetches')
  const controller = new AbortController()
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('Fetch timed out')))
  })
  aborted.catch(() => {})
  const firstByte = setTimeout(() => controller.abort(), FIRST_BYTE_MS)
  const whole = setTimeout(() => controller.abort(), FILE_MS)
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
    clearTimeout(firstByte)
    clearTimeout(whole)
    controller.abort()
  }
}

/** Runs `run` on every entry, at most `limit` at a time. */
async function eachLimited<T>(
  entries: readonly T[],
  limit: number,
  run: (entry: T) => Promise<void>,
) {
  let next = 0
  const worker = async () => {
    while (next < entries.length) await run(entries[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker))
}

/**
 * Fetches and imports each media item into the project, 4 at a time; one that
 * fails never stops the others. Answers the new media id of each saved one
 * that arrived, and the parent's ref of each new media id.
 */
export async function importMedia(media: readonly OpenMedia[], projectId: string) {
  const imported = new Map<string, string>()
  const refs: Array<{ ref: string; mediaId: string }> = []
  await eachLimited(media, FETCH_CONCURRENCY, async (entry) => {
    try {
      const blob = await fetchFile(entry)
      const { id } = await mediaLibraryService.importMediaBlob(blob, projectId, entry.name)
      imported.set(entry.mediaId, id)
      if (entry.ref) refs.push({ ref: entry.ref, mediaId: id })
    } catch (e) {
      log.warn(`NODARO_OPEN_PROJECT: could not bring in ${entry.name}`, { error: e })
    }
  })
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
