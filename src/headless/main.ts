/**
 * Headless render harness.
 *
 * This is a dedicated Vite entry (loaded by `headless.html`) that exposes a
 * small `window.freecut` API so a Node/Playwright driver can render projects to
 * video inside a real (headless) Chrome — reusing the exact same render engine
 * the editor uses, with no React UI, router, or workspace gate mounted.
 *
 * Browser APIs the render path depends on (WebCodecs, WebGPU, OffscreenCanvas,
 * OfflineAudioContext) all work in headless Chrome on a secure-context origin
 * (localhost), so fidelity matches the in-app export.
 *
 * Media is provided as fetchable URLs (served same-origin by the driver) and
 * seeded into `blobUrlManager`, so the real `resolveMediaUrls()` and the
 * engine's sub-composition media lookup resolve without the workspace/storage
 * layer being present.
 */
import type { Project } from '@/types/project'
import type { TimelineTrack, TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AudioEqSettings } from '@/types/audio'
import type { CompositionInputProps } from '@/types/export'

import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
import {
  renderComposition,
  renderAudioOnly,
} from '@/features/export/utils/canvas-render-orchestrator'
import type { ClientExportSettings, RenderProgress } from '@/features/export/utils/client-renderer'
import {
  getSupportedCodecs,
  selectFallbackVideoCodec,
  getPreferredContainerForCodec,
} from '@/features/export/utils/client-renderer'
import type { ClientVideoContainer } from '@/features/export/utils/client-renderer'
import { resolveMediaUrls } from '@/features/media-library/utils/media-resolver'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { useCompositionsStore, type SubComposition } from '@/features/export/deps/timeline'
import { editProject } from './edit'

const log = createLogger('Headless')

export interface HeadlessMediaSource {
  mediaId: string
  /** Same-origin (or CORS+CORP) URL the harness can fetch the full media bytes from. */
  url: string
}

/** Render from already-extracted timeline data (no Project schema required). */
export interface HeadlessTimelineInput {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions?: Transition[]
  fps: number
  width: number
  height: number
  inPoint?: number | null
  outPoint?: number | null
  keyframes?: ItemKeyframes[]
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb?: number
  compositions?: SubComposition[]
  media?: HeadlessMediaSource[]
  settings: ClientExportSettings
  outputFileName?: string
}

/** Render a full Project object (runs migrations, then extracts the timeline). */
export interface HeadlessProjectInput {
  project: Project
  settings: ClientExportSettings
  media?: HeadlessMediaSource[]
  /** When true (default), ignore the project's in/out points and render everything. */
  renderWholeProject?: boolean
  /**
   * Explicit render range in project frames. When provided, overrides both the
   * project's stored in/out points and renderWholeProject. Useful for rendering
   * a slice of a long project from the CLI.
   */
  inPoint?: number | null
  outPoint?: number | null
  outputFileName?: string
}

export interface HeadlessRenderSummary {
  ok: true
  mimeType: string
  fileSize: number
  durationSeconds: number
  fileName: string
}

type ProgressSink = (progress: RenderProgress) => void

function reportProgress(progress: RenderProgress): void {
  const sink = (globalThis as unknown as { __freecutProgress?: ProgressSink }).__freecutProgress
  if (!sink) return
  try {
    sink(progress)
  } catch {
    // The driver-side binding may be torn down mid-render; ignore.
  }
}

/**
 * Register media URLs so resolveMediaUrls() + the engine's sub-comp media
 * lookup (blobUrlManager.get) resolve to them. We register the URL WITHOUT
 * downloading the bytes: mediabunny then reads via UrlSource (HTTP Range),
 * so large clips stream instead of being held fully in memory.
 */
function registerMediaUrls(media: HeadlessMediaSource[] | undefined): void {
  if (!media?.length) return
  for (const { mediaId, url } of media) {
    if (blobUrlManager.get(mediaId)) continue
    blobUrlManager.registerUrl(mediaId, url)
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Defer revoke so the browser/Playwright has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 120_000)
}

function defaultFileName(settings: ClientExportSettings): string {
  return `freecut-export.${settings.container}`
}

/**
 * Ensure the requested video codec is actually encodable in this browser;
 * otherwise fall back the same way the in-app export does. Mutates and
 * returns the settings.
 */
async function adaptVideoSettings(settings: ClientExportSettings): Promise<ClientExportSettings> {
  if (settings.mode === 'audio') return settings
  const supported = await getSupportedCodecs({
    width: settings.resolution.width,
    height: settings.resolution.height,
    bitrate: settings.videoBitrate,
  })
  if (supported.includes(settings.codec)) return settings

  const container = settings.container as ClientVideoContainer
  const fallback =
    selectFallbackVideoCodec(supported, container) ?? selectFallbackVideoCodec(supported)
  if (!fallback) {
    throw new Error(
      `No supported video codec available (requested ${settings.codec}; browser supports: ${supported.join(', ') || 'none'})`,
    )
  }
  log.warn('Requested video codec unsupported; falling back', {
    requested: settings.codec,
    fallback,
    container: getPreferredContainerForCodec(fallback),
  })
  settings.codec = fallback
  settings.container = getPreferredContainerForCodec(fallback)
  return settings
}

async function renderTimeline(input: HeadlessTimelineInput): Promise<HeadlessRenderSummary> {
  const {
    tracks,
    items,
    transitions = [],
    fps,
    width,
    height,
    inPoint = null,
    outPoint = null,
    keyframes = [],
    backgroundColor,
    busAudioEq,
    masterBusDb,
    compositions = [],
    media,
    settings,
  } = input

  log.info('Headless render starting', {
    mode: settings.mode,
    codec: settings.codec,
    container: settings.container,
    resolution: `${settings.resolution.width}x${settings.resolution.height}`,
    fps,
    tracks: tracks.length,
    items: items.length,
    compositions: compositions.length,
    media: media?.length ?? 0,
  })

  // Seed sub-compositions so the engine can resolve compound clips.
  useCompositionsStore.getState().setCompositions(compositions)

  // Register media URLs (range-streamed by mediabunny) so resolveMediaUrls()
  // and the engine's sub-comp media lookup resolve without the storage layer.
  registerMediaUrls(media)

  await adaptVideoSettings(settings)

  const composition: CompositionInputProps = convertTimelineToComposition(
    tracks,
    items,
    transitions,
    fps,
    width,
    height,
    inPoint,
    outPoint,
    keyframes,
    backgroundColor,
    busAudioEq,
    masterBusDb,
  )

  // Resolve top-level media (mediaId -> seeded blob URL). Export never uses proxies.
  composition.tracks = await resolveMediaUrls(composition.tracks, { useProxy: false })

  const result =
    settings.mode === 'audio'
      ? await renderAudioOnly({ settings, composition, onProgress: reportProgress })
      : await renderComposition({ settings, composition, onProgress: reportProgress })

  const fileName = input.outputFileName ?? defaultFileName(settings)
  triggerDownload(result.blob, fileName)

  log.info('Headless render complete', {
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    durationSeconds: result.duration,
    fileName,
  })

  return {
    ok: true,
    mimeType: result.mimeType,
    fileSize: result.fileSize,
    durationSeconds: result.duration,
    fileName,
  }
}

async function renderProject(input: HeadlessProjectInput): Promise<HeadlessRenderSummary> {
  const { project: rawProject, settings, media, renderWholeProject = true, outputFileName } = input
  const { project } = migrateProject(rawProject)
  const timeline = project.timeline
  if (!timeline) {
    throw new Error('Project has no timeline to render')
  }

  const meta = project.metadata
  const hasExplicitRange = input.inPoint != null || input.outPoint != null
  const inPoint = hasExplicitRange
    ? (input.inPoint ?? null)
    : renderWholeProject
      ? null
      : (timeline.inPoint ?? null)
  const outPoint = hasExplicitRange
    ? (input.outPoint ?? null)
    : renderWholeProject
      ? null
      : (timeline.outPoint ?? null)

  return renderTimeline({
    tracks: (timeline.tracks ?? []) as unknown as TimelineTrack[],
    items: (timeline.items ?? []) as unknown as TimelineItem[],
    transitions: (timeline.transitions ?? []) as Transition[],
    fps: meta?.fps ?? 30,
    width: meta?.width ?? 1920,
    height: meta?.height ?? 1080,
    inPoint,
    outPoint,
    keyframes: (timeline.keyframes ?? []) as unknown as ItemKeyframes[],
    backgroundColor: meta?.backgroundColor,
    busAudioEq: timeline.busAudioEq,
    masterBusDb: timeline.masterBusDb,
    compositions: (timeline.compositions ?? []) as unknown as SubComposition[],
    media,
    settings,
    outputFileName,
  })
}

export interface FreecutHeadlessApi {
  ready: true
  renderTimeline: typeof renderTimeline
  renderProject: typeof renderProject
  editProject: typeof editProject
}

declare global {
  interface Window {
    freecut: FreecutHeadlessApi
  }
}

window.freecut = { ready: true, renderTimeline, renderProject, editProject }
log.info('Headless harness ready')
