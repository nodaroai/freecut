import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry'

export interface AudioDecodeRequest {
  type: 'decode'
  requestId: string
  mediaId: string
  /** Blob source, or an object-URL string resolved via the passed metadata/fallback. */
  src: string | Blob
  sourceMetadata?: ObjectUrlSourceMetadata | null
  fallbackBlob?: Blob | null
  binDurationSec: number
  storageSampleRate: number
  /**
   * Workspace root handle. When present, the worker persists decoded bins to
   * disk itself (off the main thread); otherwise it only streams them back for
   * the main thread to persist.
   */
  workspaceRoot?: FileSystemDirectoryHandle | null
}

export interface AudioDecodeWindowRequest {
  type: 'decode-window'
  requestId: string
  mediaId: string
  src: string | Blob
  sourceMetadata?: ObjectUrlSourceMetadata | null
  fallbackBlob?: Blob | null
  startTime: number
  durationSeconds: number
  storageSampleRate: number
}

export type AudioDecodeWorkerMessage = AudioDecodeRequest | AudioDecodeWindowRequest

export interface AudioDecodeBinResponse {
  type: 'bin'
  requestId: string
  binIndex: number
  frames: number
  sampleRate: number
  /** Int16 PCM, transferred. */
  left: ArrayBuffer
  right: ArrayBuffer
}

export interface AudioDecodeCompleteResponse {
  type: 'complete'
  requestId: string
  totalBins: number
}

/** A decoded playback window — Float32 stereo (not persisted, no quantization). */
export interface AudioDecodeWindowResponse {
  type: 'window'
  requestId: string
  startTime: number
  frames: number
  sampleRate: number
  /** Float32 PCM, transferred. */
  left: ArrayBuffer
  right: ArrayBuffer
}

export interface AudioDecodeErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type AudioDecodeWorkerResponse =
  | AudioDecodeBinResponse
  | AudioDecodeCompleteResponse
  | AudioDecodeWindowResponse
  | AudioDecodeErrorResponse
