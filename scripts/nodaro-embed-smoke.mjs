#!/usr/bin/env node
// Embed-protocol smoke test. A parent page on another localhost origin frames
// the editor and plays the Nodaro side of the postMessage protocol, the way
// the Nodaro app and its Studio do, then checks the round trip:
// FREECUT_READY (with `timeline-add`), NODARO_LOAD_VIDEO, NODARO_IMPORT_FILES
// with NODARO_ADD_TO_TIMELINE, the export hand-off (FREECUT_EXPORT_COMPLETE
// carrying a real MP4) and Save & Exit (FREECUT_SAVE_EXIT).
//
// Usage: node scripts/nodaro-embed-smoke.mjs [editorUrl]
//   With no editorUrl it serves this checkout's dist/ (run `npm run build`
//   first) on :4321 with the production Caddyfile's isolation headers. With an
//   editorUrl (a deployed editor) it frames that instead; that editor must
//   accept http://localhost:* as a parent.
// Needs ffmpeg on PATH (the test media is generated) and an installed Google
// Chrome (Playwright's `chrome` channel). The final screenshot is written to
// the system temp folder, and the run exits non-zero when a check fails.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const say = (line) => process.stdout.write(`${line}\n`)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDITOR_PORT = 4321
const PARENT_PORT = 4322
const editorArg = process.argv[2]
const editorUrl = editorArg ?? `http://localhost:${EDITOR_PORT}/`
const editorOrigin = new URL(editorUrl).origin
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodaro-embed-smoke-'))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
}

/** A 2-second video with sound and a 1-second tone, made with ffmpeg. */
function makeMedia() {
  const run = (args) => {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`ffmpeg could not write ${args.at(-1)} (is ffmpeg on PATH?)`)
  }
  const video = path.join(workDir, 'smoke.mp4')
  const tone = path.join(workDir, 'tone.wav')
  run([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video,
  ])
  run(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', tone])
  return { video, tone }
}

function serveDist(root) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(root, decodeURIComponent(url.pathname))
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html')
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    fs.createReadStream(file).pipe(res)
  })
}

const PARENT_HTML = `<!doctype html><html><body style="margin:0">
<iframe id="ed" src="${editorUrl}" style="width:1500px;height:950px;border:0"
  allow="autoplay; camera; microphone; storage-access"></iframe>
<script>
  window.__msgs = []
  window.addEventListener('message', (e) => {
    if (e.origin !== ${JSON.stringify(editorOrigin)}) return
    const d = e.data || {}
    const p = d.payload || {}
    // A transferred video cannot cross back to the test runner as is: keep its size and its MP4 box type.
    const payload = d.type === 'FREECUT_EXPORT_COMPLETE'
      ? {
          keepOpen: p.keepOpen,
          hasProjectJson: !!p.projectJson,
          videoBytes: p.videoBuffer ? p.videoBuffer.byteLength : 0,
          box: p.videoBuffer && p.videoBuffer.byteLength >= 8 ? String.fromCharCode(...new Uint8Array(p.videoBuffer, 4, 4)) : '',
        }
      : p
    window.__msgs.push({ type: d.type, payload, capabilities: d.capabilities })
  })
  window.__send = (msg, transfer) =>
    document.getElementById('ed').contentWindow.postMessage(msg, ${JSON.stringify(editorOrigin)}, transfer || [])
</script></body></html>`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function waitFor(fn, { timeout = 60_000, every = 250 } = {}) {
  const end = Date.now() + timeout
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > end) return null
    await new Promise((resolve) => setTimeout(resolve, every))
  }
}

const media = makeMedia()
const servers = []
if (!editorArg) {
  const dist = path.join(repoRoot, 'dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('No dist/index.html: run `npm run build` first')
  const server = serveDist(dist)
  await new Promise((resolve) => server.listen(EDITOR_PORT, 'localhost', resolve))
  servers.push(server)
}
const parent = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(PARENT_HTML)
})
await new Promise((resolve) => parent.listen(PARENT_PORT, 'localhost', resolve))
servers.push(parent)

// The installed Chrome, in a throwaway profile.
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1520, height: 980 } })
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

const msgs = () => page.evaluate(() => window.__msgs)
const msgOf = async (type, pred = () => true) => (await msgs()).find((m) => m.type === type && pred(m))
const editorFrame = () => page.frames().find((f) => f.url().startsWith(editorOrigin))
const itemCount = async () => {
  const frame = editorFrame()
  return frame ? frame.locator('[data-item-id]').count().catch(() => -1) : -1
}
const b64 = (file) => fs.readFileSync(file).toString('base64')
const screenshot = path.join(workDir, 'final.png')

try {
  await page.goto(`http://localhost:${PARENT_PORT}/`)

  const ready = await waitFor(() => msgOf('FREECUT_READY'))
  check('FREECUT_READY arrives', !!ready)
  check('READY advertises timeline-add', !!ready?.capabilities?.includes('timeline-add'), JSON.stringify(ready?.capabilities))

  // The primary video, sent as a transferred buffer (the app's path).
  await page.evaluate(([data]) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    window.__send({ type: 'NODARO_LOAD_VIDEO', payload: { videoBuffer: bytes.buffer, videoName: 'smoke.mp4' } }, [bytes.buffer])
  }, [b64(media.video)])
  const opened = await waitFor(() => /\/editor\/[^/?#]+/.test(editorFrame()?.url() ?? ''), { timeout: 90_000 })
  check('NODARO_LOAD_VIDEO opens a project in the editor', !!opened, editorFrame()?.url())
  const placed = await waitFor(async () => (await itemCount()) > 0, { timeout: 60_000 })
  check('the loaded video is placed on the timeline', !!placed, `items: ${await itemCount()}`)
  const before = await itemCount()

  // Import a second file, then ask for it at the playhead (timeline-add).
  await page.evaluate(([data]) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    window.__send({ type: 'NODARO_IMPORT_FILES', payload: { files: [{ ref: 'r1', name: 'tone.wav', type: 'audio/wav', buffer: bytes.buffer }] } }, [bytes.buffer])
    window.__send({ type: 'NODARO_ADD_TO_TIMELINE', payload: { ref: 'r1', requestId: 'q1' } })
  }, [b64(media.tone)])
  const added = await waitFor(
    async () =>
      (await msgOf('FREECUT_TIMELINE_ADDED', (m) => m.payload?.requestId === 'q1')) ||
      (await msgOf('FREECUT_TIMELINE_ADD_FAILED', (m) => m.payload?.requestId === 'q1')),
    { timeout: 60_000 },
  )
  check('NODARO_ADD_TO_TIMELINE answers FREECUT_TIMELINE_ADDED', added?.type === 'FREECUT_TIMELINE_ADDED', JSON.stringify(added?.payload))
  const grew = await waitFor(async () => (await itemCount()) > before, { timeout: 15_000 })
  check('the added file appears on the timeline', !!grew, `items: ${before} -> ${await itemCount()}`)

  // Export: the toolbar's Export, then the dialog's Export Video; the finished video must reach the parent.
  const frame = editorFrame()
  try {
    await frame.getByRole('button', { name: /^Export$/ }).first().click({ timeout: 15_000 })
    await frame.getByRole('button', { name: /Export Video/i }).last().click({ timeout: 20_000 })
    const exported = await waitFor(() => msgOf('FREECUT_EXPORT_COMPLETE'), { timeout: 180_000 })
    const p = exported?.payload ?? {}
    check(
      'a finished video export reaches the parent as a real MP4',
      !!exported && p.videoBytes > 1000 && p.box === 'ftyp' && p.keepOpen === true,
      exported ? `bytes=${p.videoBytes} box=${p.box} keepOpen=${p.keepOpen} projectJson=${p.hasProjectJson}` : 'no FREECUT_EXPORT_COMPLETE',
    )
    await page.keyboard.press('Escape').catch(() => {})
    await frame.getByRole('button', { name: /^Close$/ }).first().click({ timeout: 3_000 }).catch(() => {})
  } catch (e) {
    check('a finished video export reaches the parent as a real MP4', false, `could not drive the export UI: ${e.message.split('\n')[0]}`)
  }

  // Save & Exit hands the project back.
  await frame.getByRole('button', { name: /Save & Exit/ }).first().click({ timeout: 15_000 })
  const saved = await waitFor(() => msgOf('FREECUT_SAVE_EXIT'), { timeout: 60_000 })
  const projectJson = saved?.payload?.projectJson
  const mediaRefs = projectJson ? (JSON.stringify(projectJson).match(/"mediaId"/g)?.length ?? 0) : 0
  check('Save & Exit sends FREECUT_SAVE_EXIT with the project', !!projectJson, `mediaId refs in projectJson: ${mediaRefs}`)

  const errors = await msgs().then((all) => all.filter((m) => m.type === 'FREECUT_ERROR'))
  check('no FREECUT_ERROR', errors.length === 0, JSON.stringify(errors))
  await page.screenshot({ path: screenshot })
} finally {
  say(`messages seen: ${JSON.stringify((await msgs().catch(() => [])).map((m) => m.type))}`)
  if (consoleErrors.length) say(`console errors (${consoleErrors.length}):\n  ${consoleErrors.slice(0, 8).join('\n  ')}`)
  await browser.close()
  for (const server of servers) server.close()
}
const failed = results.filter((r) => !r.ok).length
say(`${results.length - failed}/${results.length} passed; screenshot: ${screenshot}`)
process.exit(failed ? 1 : 0)
