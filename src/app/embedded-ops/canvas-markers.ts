/**
 * The project canvas and the timeline's markers.
 * - `setCanvas { width, height }`: the project's frame size, undone with the batch.
 * - `addMarkers { markers: [{ frame, label?, color? }] }` answers the new marker ids.
 * - `removeMarkers { ids }` or `removeMarkers { all: true }`.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useProjectStore } from '@/features/projects/stores/project-store'
import { useMarkersStore } from '@/features/timeline/stores/markers-store'
import {
  addMarker,
  clearAllMarkers,
  removeMarker,
} from '@/features/timeline/stores/timeline-actions'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { updateProject as storeProject } from '@/infrastructure/storage'
import { createLogger } from '@/shared/logging/logger'
import {
  CANVAS_HEIGHT_RANGE,
  CANVAS_WIDTH_RANGE,
  fail,
  isHexColor,
  optionalBoolean,
  readEvenDimension,
  requireObjects,
} from './op-fields'

const log = createLogger('embedded-edit-ops')

const MAX_MARKER_LABEL = 200

// ── setCanvas ────────────────────────────────────────────────────────────────

/** Write the project's metadata as the editor holds it now (after the batch landed or was taken back). */
function storeCanvas(projectId: string): void {
  const { currentProject, projects } = useProjectStore.getState()
  const project =
    currentProject?.id === projectId
      ? currentProject
      : projects.find((candidate) => candidate.id === projectId)
  if (!project) return
  void Promise.resolve(storeProject(projectId, { metadata: { ...project.metadata } })).catch(
    (error: unknown) => log.error(`Could not store the canvas size of ${projectId}:`, error),
  )
}

export function applySetCanvas(op: EditOp): unknown {
  const width = readEvenDimension(
    op,
    op.width,
    'width',
    CANVAS_WIDTH_RANGE.min,
    CANVAS_WIDTH_RANGE.max,
  )
  const height = readEvenDimension(
    op,
    op.height,
    'height',
    CANVAS_HEIGHT_RANGE.min,
    CANVAS_HEIGHT_RANGE.max,
  )
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('No project is open')
  if (project.metadata.width === width && project.metadata.height === height) {
    return { width, height }
  }

  // Set synchronously, as undo restores it: the batch's history entry captures
  // the project metadata, so undoing the batch puts the old size back.
  const metadata = { ...project.metadata, width, height }
  const updatedAt = Date.now()
  useProjectStore.setState((state) => ({
    currentProject:
      state.currentProject?.id === project.id
        ? { ...state.currentProject, metadata, updatedAt }
        : state.currentProject,
    projects: state.projects.map((candidate) =>
      candidate.id === project.id ? { ...candidate, metadata, updatedAt } : candidate,
    ),
  }))
  useTimelineSettingsStore.getState().markDirty()
  // The batch runs synchronously; once it has landed (or been rolled back),
  // store whichever size the editor then holds.
  queueMicrotask(() => storeCanvas(project.id))
  return { width, height }
}

// ── markers ──────────────────────────────────────────────────────────────────

interface MarkerInput {
  frame: number
  label?: string
  color?: string
}

function readMarker(op: EditOp, entry: Record<string, unknown>, index: number): MarkerInput {
  const { frame, label, color } = entry
  if (typeof frame !== 'number' || !Number.isFinite(frame) || frame < 0) {
    fail(op, `markers[${index}].frame must be a frame number, 0 or more`)
  }
  if (label !== undefined && typeof label !== 'string') {
    fail(op, `markers[${index}].label must be text`)
  }
  if (color !== undefined && !isHexColor(color)) {
    fail(op, `markers[${index}].color must be a hex color such as #FFB020`)
  }
  const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_MARKER_LABEL) : ''
  return {
    frame: Math.round(frame),
    ...(trimmed ? { label: trimmed } : {}),
    ...(typeof color === 'string' ? { color } : {}),
  }
}

export function applyAddMarkers(op: EditOp): unknown {
  const markers = requireObjects(op, 'markers', '{ frame, label?, color? }').map((entry, index) =>
    readMarker(op, entry, index),
  )
  const ids = markers.map(({ frame, label, color }) => {
    addMarker(frame, color, label)
    // The markers store appends: the newest marker is the one just added.
    const added = useMarkersStore.getState().markers.at(-1)
    if (!added) throw new Error(`addMarkers: the marker at frame ${frame} was not added`)
    return added.id
  })
  return { ids }
}

function requireMarkerIds(op: EditOp): string[] {
  const ids = op.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    throw new Error(`${op.op} requires \`ids\`, a list of marker ids, or \`all: true\``)
  }
  return [...new Set(ids as string[])]
}

export function applyRemoveMarkers(op: EditOp): unknown {
  const existing = useMarkersStore.getState().markers.map((marker) => marker.id)
  if (optionalBoolean(op, 'all') === true) {
    if (existing.length > 0) clearAllMarkers()
    return { removed: existing }
  }
  const ids = requireMarkerIds(op)
  const known = new Set(existing)
  const unknown = ids.find((id) => !known.has(id))
  if (unknown !== undefined) fail(op, `marker "${unknown}" does not exist`)
  for (const id of ids) removeMarker(id)
  return { removed: ids }
}
