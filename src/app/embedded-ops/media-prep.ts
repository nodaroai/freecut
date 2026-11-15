/**
 * Reading media files before a batch starts. An operation's `prepare` reads
 * storage (which awaits); its `apply` then runs synchronously inside the batch
 * with what `prepare` attached to the operation.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { mediaIdForRef } from '@/features/embedded/services/imported-refs'
import { mediaLibraryService } from '@/features/media-library/services/media-library-service'
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
import { getMediaType } from '@/features/media-library/utils/validation'
import type { MediaMetadata } from '@/types/storage'
import { fail } from './op-fields'

/** The kinds of file an operation can put on the timeline. */
export type PlaceableKind = 'video' | 'audio' | 'image'

export interface PreparedMedia {
  readonly media: MediaMetadata
  readonly kind: PlaceableKind
  readonly blobUrl: string
}

/** Data `prepare` read for one operation, handed to its `apply`. */
export function preparedData<T>(opName: string) {
  const byOp = new WeakMap<EditOp, T>()
  return {
    attach(op: EditOp, data: T): EditOp {
      const prepared = { ...op }
      byOp.set(prepared, data)
      return prepared
    },
    read(op: EditOp): T {
      const data = byOp.get(op)
      if (!data) throw new Error(`${opName} was not prepared`)
      return data
    },
  }
}

/** One media file's metadata, read from storage (never the media store, which refreshes late). */
export async function readMediaMetadata(mediaId: string): Promise<MediaMetadata> {
  const media = await mediaLibraryService.getMedia(mediaId)
  if (!media) throw new Error(`Media ${mediaId} is not in Media`)
  return media
}

/** One media file from storage, with a URL the editor can play it from. */
export async function prepareMedia(op: EditOp, mediaId: string): Promise<PreparedMedia> {
  const media = await readMediaMetadata(mediaId)
  const kind = getMediaType(media.mimeType)
  if (kind !== 'video' && kind !== 'audio' && kind !== 'image') {
    fail(op, `${media.fileName} is not a video, audio or image file`)
  }
  const blobUrl = await resolveMediaUrl(mediaId)
  if (!blobUrl) throw new Error(`Media ${mediaId} could not be read`)
  return { media, kind, blobUrl }
}

/**
 * The media id an entry names, either directly (`idField`) or by the ref a
 * parent imported it under (`refField`). A ref still being imported is waited for.
 */
export async function mediaIdOf(
  op: EditOp,
  entry: Record<string, unknown>,
  fields: { id: string; ref: string; path: string },
): Promise<string> {
  const id = entry[fields.id]
  if (typeof id === 'string' && id.length > 0) return id
  const ref = entry[fields.ref]
  if (typeof ref === 'string' && ref.length > 0) {
    const imported = await mediaIdForRef(ref)
    if (!imported) throw new Error(`"${ref}" is not in Media`)
    return imported
  }
  fail(op, `${fields.path ? `${fields.path} ` : ''}needs \`${fields.id}\` or \`${fields.ref}\``)
}
