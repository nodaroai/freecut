# FreeCut Nodaro Integration Design

## Overview

Add embedded mode support to FreeCut so it can be loaded inside an iframe by the Nodaro app (`app.nodaro.ai`). When embedded, FreeCut receives a video URL via postMessage, auto-creates a project with the video on the timeline, and provides a one-click "Send Back" button that exports the edited video and transfers it back to the parent frame.

## Context

Nodaro is a visual workflow platform for AI video generation. Its "Manual Edit" node pauses workflow execution to let the user manually edit a video in FreeCut. The Nodaro side is already built (`freecut-editor-modal.tsx` with postMessage protocol). This spec covers the FreeCut side of that integration, plus Railway deployment.

**Nodaro iframe sandbox**: The embedding iframe uses `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`. This means no `allow-downloads` (fine — embedded mode sends back via postMessage, not browser download). The `allow-scripts allow-same-origin` combination is sufficient for WebGPU, WebCodecs, and SharedArrayBuffer.

## postMessage Protocol

### Outbound: `FREECUT_READY`

```json
{ "type": "FREECUT_READY" }
```

Sent by FreeCut once its message listener is active. Nodaro should wait for this before sending `NODARO_LOAD_VIDEO` instead of relying on a hardcoded 500ms delay.

**Backward compatibility**: The listener is registered synchronously at app init, so even if Nodaro sends `NODARO_LOAD_VIDEO` before `FREECUT_READY` (current 500ms delay behavior), it will still be processed. `FREECUT_READY` is an improvement for Nodaro to adopt, not a hard requirement.

### Inbound: `NODARO_LOAD_VIDEO`

```json
{ "type": "NODARO_LOAD_VIDEO", "payload": { "videoUrl": "https://..." } }
```

Sent by Nodaro after receiving `FREECUT_READY` (or after 500ms fallback). FreeCut must:
1. Validate `event.origin` against allowlist (see Security section)
2. Store the origin for all outbound messages
3. Fetch the video from the URL
4. Extract metadata via worker
5. Create a new project matching the video's native resolution and fps
6. Import the video into the media library
7. Store `mediaId` as pending import in embedded store
8. Navigate to the editor
9. After `loadTimeline()` completes in the editor, place video item on the default track

### Outbound: `FREECUT_EXPORT_PROGRESS`

```json
{ "type": "FREECUT_EXPORT_PROGRESS", "payload": { "percent": 0.5 } }
```

Sent during export so Nodaro can display progress in its own UI.

### Outbound: `FREECUT_EXPORT_COMPLETE`

```json
{ "type": "FREECUT_EXPORT_COMPLETE", "payload": { "videoBuffer": ArrayBuffer } }
```

Sent when export finishes. The ArrayBuffer is the rendered MP4.

### Outbound: `FREECUT_ERROR`

```json
{ "type": "FREECUT_ERROR", "payload": { "phase": "import" | "export", "message": "..." } }
```

Sent when video fetch, import, or export fails. Allows Nodaro to show an error state instead of hanging.

## Security

**Inbound origin validation**: The message handler validates `event.origin` against an allowlist:
- `https://app.nodaro.ai`
- `https://next.nodaro.ai`
- `http://localhost:*` (dev)
- `https://*.up.railway.app`

**Outbound target origin**: On receiving the first `NODARO_LOAD_VIDEO`, store `event.origin`. Use this stored origin (not `'*'`) as the target for all outbound `postMessage` calls. This prevents leaking video content to arbitrary origins.

## Design

### 1. Embedded Mode State

**New module**: `src/features/embedded/`

A Zustand store `useEmbeddedStore`:
```ts
{
  isEmbedded: boolean              // window.self !== window.top
  parentOrigin: string | null      // stored from first inbound message
  inputMetadata: {                 // from source video, used by Send Back export
    codec: string                  // raw codec from media processor (e.g. 'avc', 'hevc')
    width: number
    height: number
    fps: number
  } | null
  pendingVideoImport: {            // set before navigation, consumed after loadTimeline completes
    mediaId: string                // ID of the imported media in media library
  } | null
  sendBackStatus: 'idle' | 'exporting' | 'sent' | 'error'
  exportProgress: number           // 0-1
}
```

`pendingVideoImport` is intentionally minimal — only `mediaId` is stored. All other data (MediaMetadata, blob URL, thumbnail URL) is derived from the media library store and existing resolution utilities after editor mount. This avoids duplicating data and stale references.

A companion `isEmbedded()` utility (non-hook, reads from store) for use outside React components.

A `useEmbeddedMode()` hook for React components that selects `isEmbedded` from the store.

### 2. postMessage Listener

**File**: `src/features/embedded/services/embedded-message-handler.ts`

Initialized once at app startup (in `app.tsx`) when `isEmbedded()` is true. The listener is registered **synchronously** so it catches messages even before `FREECUT_READY` is sent. After registration, immediately posts `FREECUT_READY` to `window.parent`.

On receiving `NODARO_LOAD_VIDEO`:

1. **Validate origin** against allowlist. Reject if not allowed.

2. **Store origin** in `useEmbeddedStore` for outbound messages.

3. **Fetch video**: `fetch(videoUrl)` → `Blob`. The video URL comes from Nodaro's R2 storage (CORS-enabled).

4. **Wrap as File**: `new File([blob], 'nodaro-edit.mp4', { type: blob.type })` — `processMedia()` requires a `File` object.

5. **Extract metadata**: `mediaProcessorService.processMedia(file, blob.type)` — note: `mimeType` is the required second argument. Returns `{ metadata, thumbnail }` with duration, width, height, fps, codec, audioCodec, audioCodecSupported, and optional thumbnail Blob.

6. **Create project**: Use `createProject()` from the project store (accepts `ProjectFormData`, returns `Promise<Project>`, does NOT navigate):
   - Name: "Nodaro Edit"
   - Width/height: from video metadata
   - FPS: rounded to nearest allowed value via `roundToNearestAllowedFps()` — maps e.g. 29.97→30, 23.976→24, 59.94→60 against `[24, 25, 30, 50, 60, 120, 240]`
   - backgroundColor: `'#000000'`

7. **Import to media library**: Use new `importMediaBlob()` method (see Section 6). Returns `MediaMetadata`.

8. **Store pending import**: Set `pendingVideoImport: { mediaId: metadata.id }` in `useEmbeddedStore`.

9. **Store input metadata**: Save codec, resolution, fps in `useEmbeddedStore.inputMetadata` for the "Send Back" export.

10. **Navigate**: Use TanStack Router to navigate to `/editor/{projectId}`.

11. **On error**: Post `FREECUT_ERROR` to parent with `phase: 'import'` and message.

### 3. Video Placement After Editor Mount

**File**: `src/features/editor/components/editor.tsx` (modify)

**Timing constraint**: `loadTimeline(projectId)` is called in editor.tsx's useEffect but is **not awaited** — it fires asynchronously. The default "Track 1" is only available after `loadTimeline()` resolves. The pending video import must wait for this.

**Approach**: Chain the video placement onto the existing `loadTimeline()` call:

```ts
// Current code (line ~144):
loadTimeline(projectId).catch((error) => { ... });

// Modified:
loadTimeline(projectId)
  .then(() => consumePendingEmbeddedImport())
  .catch((error) => { ... });
```

`consumePendingEmbeddedImport()` checks `useEmbeddedStore.getState().pendingVideoImport` and if present:

1. **Read mediaId** from `pendingVideoImport`.
2. **Get MediaMetadata** from `useMediaLibraryStore.getState().mediaById[mediaId]`.
3. **Get blob URL** via `resolveMediaUrl(mediaId)` from `media-resolver.ts` — this handles OPFS read → Blob creation → ref-counted `URL.createObjectURL()` via the existing `blobUrlManager`. No manual OPFS reads needed.
4. **Get thumbnail URL** via `mediaLibraryService.getMediaBlobUrl(metadata.thumbnailId)` if thumbnailId exists, or derive from the thumbnail storage.
5. **Get default track**: `useItemsStore.getState().tracks[0]` — created by `loadTimeline()` for new projects.
6. **Calculate duration**: Use `getDroppedMediaDurationInFrames(metadata, 'video', timelineFps)` from `dropped-media.ts` — converts `metadata.duration` (seconds) to frames using project FPS.
7. **Build video item**: Use `buildDroppedMediaTimelineItem()` with:
   ```ts
   buildDroppedMediaTimelineItem({
     media: metadata,           // MediaMetadata from store
     mediaId: metadata.id,
     mediaType: 'video',
     label: metadata.fileName,
     timelineFps: fps,          // from project.metadata.fps
     blobUrl,                   // from resolveMediaUrl()
     thumbnailUrl,              // from thumbnail resolution
     canvasWidth: project.metadata.width,   // = input video width
     canvasHeight: project.metadata.height, // = input video height
     placement: {
       trackId: tracks[0].id,
       from: 0,
       durationInFrames,        // from getDroppedMediaDurationInFrames()
     },
   })
   ```
   This handles source frame calculations, FPS conversion, and `computeInitialTransform()` (scales video to fit canvas — identity in this case since project matches video resolution).
8. **Add to timeline**: `addItem(videoItem)` — no special setup needed, handles overlap detection and undo/redo automatically.
9. **Clear pending**: Set `pendingVideoImport: null` in embedded store.

### 4. Toolbar Changes (Embedded Mode)

**File**: `src/features/editor/components/toolbar.tsx`

When `isEmbedded`:

**Hide**:
- Back button (no navigation outside editor in embedded mode)
- GitHub link
- Save button (no persistent local saves needed for embedded edits)
- Export dropdown (replaced by Send Back)
- Settings button
- Shortcuts button

**Show**:
- Project name + dimensions (read-only context)
- **"Send Back" button** — prominent, right-aligned
  - Icon: `Upload` or `Send` from lucide-react
  - Label: "Send Back" (idle) → "Exporting... X%" (during export) → "Sent!" (complete)
  - Disabled during export
  - On click: triggers the embedded export flow via `useSendBack()` hook

### 5. Embedded Export Flow

**File**: `src/features/embedded/hooks/use-send-back.ts`

A React hook that composes `useClientRender` (from export feature, accessed through `deps/` adapter) and adds postMessage logic. `useClientRender` uses React `useState` internally — all state changes (progress, result, status, error) trigger re-renders, so `useSendBack` can react to them via `useEffect`.

**Pre-requisite**: `useClientRender` must be added to the export feature's public API (`src/features/export/index.ts`). Currently it's only used internally by `export-dialog.tsx` and is not exported. The hook has no context providers or special environment requirements — it works anywhere as long as Zustand stores are initialized.

On "Send Back" click:

1. **Resolve export settings** from `useEmbeddedStore.inputMetadata`:
   - Codec: reverse-map input codec to ExportSettings codec:
     ```ts
     const CODEC_REVERSE_MAP: Record<string, ExportSettings['codec']> = {
       avc: 'h264', hevc: 'h265', vp8: 'vp8', vp9: 'vp9'
     }
     // Fallback to 'h264' for unknown codecs
     ```
   - Resolution: match input width x height
   - Quality: `'high'` preset (10 Mbps — good approximation of source quality)
   - Container: `'mp4'`
   - Mode: `'video'`
   - `renderWholeProject: true` (export full timeline, ignore any in/out points)

2. **Trigger export** using `useClientRender`'s `startExport()`:
   - Pass `ExtendedExportSettings` with the resolved settings
   - `startExport()` internally reads timeline state from `useTimelineStore.getState()` and project metadata from `useProjectStore.getState()` — no need to pass timeline data through

3. **Report progress** via `useEffect` reacting to `progress` state changes:
   ```ts
   useEffect(() => {
     if (status === 'rendering' || status === 'encoding') {
       window.parent.postMessage(
         { type: 'FREECUT_EXPORT_PROGRESS', payload: { percent: progress / 100 } },
         parentOrigin
       )
     }
   }, [progress, status, parentOrigin])
   ```

4. **Send result** via `useEffect` reacting to `result` state change:
   ```ts
   useEffect(() => {
     if (status === 'completed' && result?.blob) {
       result.blob.arrayBuffer().then((buffer) => {
         window.parent.postMessage(
           { type: 'FREECUT_EXPORT_COMPLETE', payload: { videoBuffer: buffer } },
           parentOrigin
         )
         useEmbeddedStore.getState().setSendBackStatus('sent')
       })
     }
   }, [status, result, parentOrigin])
   ```

5. **UI update**: `sendBackStatus` in store drives button state. "Sent!" with check icon for 3 seconds, then resets to idle.

6. **On error** via `useEffect` reacting to `status === 'failed'`:
   ```ts
   useEffect(() => {
     if (status === 'failed' && error) {
       window.parent.postMessage(
         { type: 'FREECUT_ERROR', payload: { phase: 'export', message: error } },
         parentOrigin
       )
       useEmbeddedStore.getState().setSendBackStatus('error')
     }
   }, [status, error, parentOrigin])
   ```

### 6. Video Import from Blob

**New method**: `mediaLibraryService.importMediaBlob(blob, projectId, filename)`

The existing `importMediaWithHandle()` handles all media types but requires a `FileSystemFileHandle`. The existing `importGeneratedImage()` uses OPFS storage but explicitly rejects non-image types (`if (!mimeType.startsWith('image/'))` guard). A new method combines the strengths of both — full worker metadata extraction (like `importMediaWithHandle`) with OPFS storage (like `importGeneratedImage`):

1. **Wrap blob**: `new File([blob], filename, { type: blob.type })`
2. **Process via worker**: `mediaProcessorService.processMedia(file, blob.type)` — same worker as `importMediaWithHandle()`. Returns `{ metadata, thumbnail }` with all video-specific fields.
3. **Generate media ID**: `crypto.randomUUID()`
4. **Generate OPFS path**: `content/${mediaId.slice(0,2)}/${mediaId.slice(2,4)}/${mediaId}/data` (same pattern as `importGeneratedImage()`)
5. **Convert blob to ArrayBuffer**: `await blob.arrayBuffer()`
6. **Store in OPFS**: `opfsService.saveFile(opfsPath, arrayBuffer)` — saves the full video to Origin Private File System
7. **Save thumbnail** (if returned by worker): `saveThumbnailDB(thumbnail)` → `thumbnailId`
8. **Save metadata to IndexedDB**: Create `MediaMetadata` with:
   - `storageType: 'opfs'`, `opfsPath`
   - All fields from worker result: `duration`, `width`, `height`, `fps`, `codec`, `bitrate`, `audioCodec`, `audioCodecSupported`
   - `thumbnailId` from step 7
   - `fileName`, `fileSize: blob.size`, `mimeType: blob.type`
9. **Associate with project**: `associateMediaWithProject(mediaId, projectId)`
10. **Return** `MediaMetadata`

**Error handling**: 3-level rollback following `importGeneratedImage()` pattern — if metadata save fails, clean up OPFS; if OPFS fails, clean up metadata.

### 7. Cross-Feature Dependencies

Per CLAUDE.md, cross-feature imports must go through `deps/` adapter modules. The `embedded` feature needs adapters for:

| Dependency | Adapter File | What It Exposes |
|------------|-------------|-----------------|
| `export` | `src/features/embedded/deps/export-contract.ts` | `useClientRender` hook |
| `projects` | `src/features/embedded/deps/projects-contract.ts` | `useProjectStore` (for `createProject()`) |
| `media-library` | `src/features/embedded/deps/media-library-contract.ts` | `importMediaBlob()`, `resolveMediaUrl()`, `useMediaLibraryStore` |
| `timeline` | `src/features/embedded/deps/timeline-contract.ts` | `addItem()`, `buildDroppedMediaTimelineItem()`, `getDroppedMediaDurationInFrames()`, `useItemsStore` |

These follow the existing pattern (e.g., `src/features/export/deps/projects-contract.ts`) — simple re-exports with no adapter logic.

Additionally, the export feature's public API (`src/features/export/index.ts`) must be extended to export `useClientRender`.

### 8. Railway Deployment

#### COEP/COOP and iframe Compatibility

The current codebase uses `COEP: require-corp` + `COOP: same-origin` everywhere:
- `vite.config.ts` (dev server + preview)
- `vercel.json` (production — also has `X-Frame-Options: DENY`)

`COOP: same-origin` breaks cross-origin iframe embedding — parent and iframe end up in different browsing context groups, breaking `postMessage`. `X-Frame-Options: DENY` blocks iframe embedding entirely.

Solution: Use `COEP: credentialless` + `COOP: same-origin-allow-popups`. This preserves SharedArrayBuffer support while allowing cross-origin iframe embedding. Supported in Chrome 110+, Firefox 119+ — sufficient for FreeCut's target browsers (WebGPU/WebCodecs require modern browsers anyway).

**All three configs must be updated**: `vite.config.ts` (dev), `Caddyfile` (Railway production), and `vercel.json` (if kept for upstream compatibility).

#### Dockerfile

Multi-stage build:
1. **Builder stage**: `node:22.14-slim`, `npm ci`, `npm run build` → produces `dist/`
2. **Runtime stage**: `caddy:2.9-alpine`, copies `dist/` and `Caddyfile`

Caddy is chosen because:
- Nodaro already uses Caddy in its stack
- Lightweight (~40MB image)
- Declarative config for headers
- Built-in SPA routing support

#### Caddyfile

```caddyfile
:3000 {
    root * /srv
    encode gzip zstd
    file_server
    try_files {path} /index.html

    header {
        Cross-Origin-Embedder-Policy "credentialless"
        Cross-Origin-Opener-Policy "same-origin-allow-popups"
        Cross-Origin-Resource-Policy "cross-origin"
        Content-Security-Policy "frame-ancestors 'self' https://app.nodaro.ai https://next.nodaro.ai http://localhost:* https://*.up.railway.app"
        X-Frame-Options ""
    }
}
```

Key headers:
- **COEP `credentialless`**: Enables SharedArrayBuffer without breaking iframe embedding
- **COOP `same-origin-allow-popups`**: Allows cross-origin parent access for postMessage
- **CORP `cross-origin`**: Allows Nodaro's iframe to load FreeCut assets
- **CSP `frame-ancestors`**: Whitelist Nodaro domains + localhost for dev
- **`encode gzip zstd`**: Compresses JS/CSS bundles for faster load
- **`X-Frame-Options ""`**: Clear this header (CSP frame-ancestors supersedes it)

#### railway.toml

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
```

#### Vite Dev Config Update

`vite.config.ts` headers must be updated for both `server` and `preview` blocks:
- `Cross-Origin-Embedder-Policy`: `require-corp` → `credentialless`
- `Cross-Origin-Opener-Policy`: `same-origin` → `same-origin-allow-popups`

This is required for local embedded mode testing (FreeCut on :5174, Nodaro on :5173).

#### vercel.json Update

Update headers to match:
- `Cross-Origin-Embedder-Policy`: `require-corp` → `credentialless`
- `Cross-Origin-Opener-Policy`: `same-origin` → `same-origin-allow-popups`
- `X-Frame-Options`: `DENY` → remove or replace with CSP `frame-ancestors`

This keeps vercel.json consistent even though Railway/Caddy is the primary deployment target for this fork.

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/features/embedded/stores/embedded-store.ts` | Create | Zustand store for embedded state |
| `src/features/embedded/hooks/use-embedded-mode.ts` | Create | `useEmbeddedMode()` hook + `isEmbedded()` utility |
| `src/features/embedded/hooks/use-send-back.ts` | Create | Hook composing useClientRender + postMessage send |
| `src/features/embedded/services/embedded-message-handler.ts` | Create | postMessage listener + FREECUT_READY handshake |
| `src/features/embedded/utils/codec-mapping.ts` | Create | `CODEC_REVERSE_MAP`, `roundToNearestAllowedFps()` |
| `src/features/embedded/deps/export-contract.ts` | Create | Cross-feature adapter for export |
| `src/features/embedded/deps/projects-contract.ts` | Create | Cross-feature adapter for projects |
| `src/features/embedded/deps/media-library-contract.ts` | Create | Cross-feature adapter for media library |
| `src/features/embedded/deps/timeline-contract.ts` | Create | Cross-feature adapter for timeline |
| `src/features/embedded/index.ts` | Create | Barrel exports |
| `src/features/media-library/services/media-library-service.ts` | Modify | Add `importMediaBlob()` method |
| `src/features/export/index.ts` | Modify | Export `useClientRender` in public API |
| `src/features/editor/components/toolbar.tsx` | Modify | Conditional UI for embedded mode |
| `src/features/editor/components/editor.tsx` | Modify | Chain `consumePendingEmbeddedImport()` after `loadTimeline().then()` |
| `src/app.tsx` | Modify | Init embedded message listener on startup |
| `vite.config.ts` | Modify | Update COEP/COOP headers for iframe compat |
| `vercel.json` | Modify | Update COEP/COOP/X-Frame-Options headers |
| `Dockerfile` | Create | Multi-stage build with Caddy |
| `Caddyfile` | Create | Static serving with required headers |
| `railway.toml` | Create | Railway deployment config |

## Non-Goals

- No authentication between Nodaro and FreeCut (iframe sandbox + origin checks are sufficient)
- No persistent project storage in embedded mode (projects are ephemeral — edit and send back)
- No multi-video import (one video per embedded session)
- No custom domain setup (handled manually in Railway after deployment)

## Testing Strategy

- Unit test `isEmbedded()` with mocked `window.self`/`window.top`
- Unit test message handler with mocked postMessage events + origin validation
- Unit test codec reverse mapping (`'avc'`→`'h264'`, `'hevc'`→`'h265'`, unknown→`'h264'`)
- Unit test `roundToNearestAllowedFps()` (29.97→30, 23.976→24, 59.94→60, 48→50, exact values unchanged)
- Integration test: embedded export flow (mock export pipeline, verify postMessage output with correct origin)
- Integration test: pendingVideoImport consumed after `loadTimeline()` resolves
- Manual E2E: run FreeCut locally on :5174, run Nodaro on :5173, test full flow
