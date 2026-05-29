/**
 * Final render outputs from the export queue.
 *
 * Writes rendered video/audio files to `{workspace}/exports/` so they're
 * discoverable when browsing the workspace folder on disk. Picks a
 * non-clobbering filename (appends ` (2)`, ` (3)`, …) so re-rendering the same
 * segment doesn't overwrite a previous result.
 */

import { requireWorkspaceRoot } from './root'
import { exists, readBlob, readDirectoryFiles, removeEntry, writeBlob } from './fs-primitives'
import { EXPORTS_DIR, exportFilePath, exportsDir, sanitizeWorkspaceFileName } from './paths'

export interface SavedExport {
  /** The on-disk filename actually used (after de-duplication). */
  fileName: string
  /** Workspace-root-relative path, forward-slash separated (for display). */
  relPath: string
}

export interface ExportFileEntry {
  name: string
  size: number
  /** Epoch ms of the file's last modification (0 when unavailable). */
  lastModified: number
}

/** Insert a ` (n)` suffix before the extension: `clip.mp4` → `clip (2).mp4`. */
function suffixFileName(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = hasExt ? fileName.slice(0, dot) : fileName
  const ext = hasExt ? fileName.slice(dot) : ''
  return `${stem} (${n})${ext}`
}

async function uniqueExportFileName(
  root: FileSystemDirectoryHandle,
  fileName: string,
): Promise<string> {
  const safe = sanitizeWorkspaceFileName(fileName)
  if (!(await exists(root, exportFilePath(safe)))) return safe
  for (let n = 2; n < 1000; n++) {
    const candidate = suffixFileName(safe, n)
    if (!(await exists(root, exportFilePath(candidate)))) return candidate
  }
  // Pathological fallback — guaranteed unique enough.
  return suffixFileName(safe, Date.now())
}

/**
 * Save a rendered blob to `{workspace}/exports/`, returning the final filename
 * and workspace-relative path. Throws if no workspace root is set.
 */
export async function saveExportFile(fileName: string, data: Blob): Promise<SavedExport> {
  const root = requireWorkspaceRoot()
  const name = await uniqueExportFileName(root, fileName)
  await writeBlob(root, exportFilePath(name), data)
  return { fileName: name, relPath: `${EXPORTS_DIR}/${name}` }
}

/** List files saved under `exports/`, newest first. Empty when the dir is absent. */
export async function listExportFiles(): Promise<ExportFileEntry[]> {
  const files = await readDirectoryFiles(requireWorkspaceRoot(), exportsDir())
  return files
    .map(({ name, blob }) => ({
      name,
      size: blob.size,
      // readDirectoryFiles hands back File handles (getFile()), so lastModified
      // is available without reading the bytes.
      lastModified: (blob as File).lastModified ?? 0,
    }))
    .sort((a, b) => b.lastModified - a.lastModified)
}

/** Read a saved export's bytes (for download). Null when missing. */
export function readExportFile(name: string): Promise<Blob | null> {
  return readBlob(requireWorkspaceRoot(), exportFilePath(name))
}

/** Delete a saved export. No-op when missing. */
export function deleteExportFile(name: string): Promise<void> {
  return removeEntry(requireWorkspaceRoot(), exportFilePath(name))
}
