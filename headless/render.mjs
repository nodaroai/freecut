// FreeCut headless render CLI.
//
// Renders a project from a workspace folder to a video file, driving the real
// render engine inside headless Chrome via the window.freecut harness.
//
// Usage:
//   node headless/render.mjs --workspace <dir> --project <id|project.json> [options]
//   node headless/render.mjs --workspace <dir> --list
//
// Options:
//   --out <path>           Output file (default: ./<project-name>.<container>)
//   --codec <c>            h264|h265|vp9|vp8|av1 (default: h264)
//   --container <c>        mp4|webm|mov|mkv (default: derived from codec)
//   --resolution <WxH>     Override output resolution (default: project metadata)
//   --fps <n>              Override fps (default: project metadata)
//   --quality <q>          low|medium|high|ultra (default: high)
//   --in <sec>             Render range start in seconds (default: 0 if --out/--duration given)
//   --out-sec <sec>        Render range end in seconds
//   --duration <sec>       Render this many seconds from --in (default 0)
//   --audio-only           Render audio only (container default: mp3)
//   --head                 Run headed (visible browser) for debugging
//   --list                 List projects in the workspace and exit
//   --build                Build dist/ first if the harness isn't built yet
//   --harness-url <url>    Dev mode: drive a running Vite dev server instead of
//                          the bundled dist/ (e.g. http://localhost:5173/headless.html)
//
// By default this serves the built harness (dist/) itself — no dev server
// needed. Run `npm run build` once (or pass --build) to produce dist/.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { loadProject, listProjects, collectMediaIds, resolveMediaFiles } from './lib/workspace.mjs'
import { createMediaServer } from './media-server.mjs'
import { createHarnessServer } from './server.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--use-angle=d3d11',
]

const CODEC_MAP = { h264: 'avc', avc: 'avc', h265: 'hevc', hevc: 'hevc', vp9: 'vp9', vp8: 'vp8', av1: 'av1' }
const DEFAULT_CONTAINER = { avc: 'mp4', hevc: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'webm' }
const VIDEO_BITRATE_BY_QUALITY = { low: 2_500_000, medium: 5_000_000, high: 10_000_000, ultra: 20_000_000 }

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

function buildSettings(project, args) {
  const meta = project.metadata ?? {}
  const fps = args.fps ? Number(args.fps) : (meta.fps ?? 30)
  let width = meta.width ?? 1920
  let height = meta.height ?? 1080
  if (args.resolution) {
    const m = /^(\d+)x(\d+)$/.exec(args.resolution)
    if (!m) throw new Error(`Invalid --resolution "${args.resolution}" (expected WxH, e.g. 1920x1080)`)
    width = Number(m[1])
    height = Number(m[2])
  }
  const quality = args.quality ?? 'high'

  if (args['audio-only']) {
    const container = args.container ?? 'mp3'
    return {
      mode: 'audio',
      codec: 'avc', // ignored for audio mode
      audioCodec: container === 'mp3' ? 'mp3' : container === 'wav' ? 'pcm-s16' : 'aac',
      container,
      quality,
      resolution: { width, height },
      fps,
      audioBitrate: 192_000,
    }
  }

  const codecInput = (args.codec ?? 'h264').toLowerCase()
  const codec = CODEC_MAP[codecInput]
  if (!codec) throw new Error(`Unknown --codec "${args.codec}" (use h264|h265|vp9|vp8|av1)`)
  const container = args.container ?? DEFAULT_CONTAINER[codec]

  return {
    mode: 'video',
    codec,
    audioCodec: container === 'webm' ? 'opus' : 'aac',
    container,
    quality,
    resolution: { width, height },
    fps,
    videoBitrate: VIDEO_BITRATE_BY_QUALITY[quality] ?? 10_000_000,
    audioBitrate: 192_000,
  }
}

async function ensureHarnessReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (res.ok) return
  } catch {
    // fall through
  }
  throw new Error(
    `Dev harness not reachable at ${url}.\n` +
      `Start the dev server first:  npm run dev`,
  )
}

/**
 * Stand up the harness + media servers and return a uniform interface.
 * Default: standalone server over the built dist/. With --harness-url: drive a
 * running Vite dev server, serving media from a separate cross-origin server.
 */
async function startServers(args, files) {
  const devUrl = args['harness-url']
  if (devUrl) {
    await ensureHarnessReachable(devUrl)
    const mediaServer = await createMediaServer(files)
    return {
      harnessUrl: devUrl,
      mediaUrlOf: (id) => mediaServer.url(id),
      closeServers: () => mediaServer.close(),
    }
  }

  const distDir = path.join(REPO_ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    if (args.build) {
      console.log('Building dist/ (npm run build)...')
      execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
    } else {
      throw new Error(
        'Harness not built: dist/headless.html is missing.\n' +
          'Run `npm run build` once (or pass --build), or use --harness-url with `npm run dev`.',
      )
    }
  }

  const server = await createHarnessServer({ distDir, mediaFiles: files })
  return {
    harnessUrl: server.harnessUrl,
    mediaUrlOf: (id) => server.mediaUrl(id),
    closeServers: () => server.close(),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const workspace = args.workspace
  if (!workspace) throw new Error('Missing --workspace <dir>')
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`)

  if (args.list) {
    const projects = listProjects(workspace)
    if (projects.length === 0) {
      console.log('No projects found in workspace.')
      return
    }
    console.log(`Projects in ${workspace}:`)
    for (const p of projects) {
      console.log(`  ${p.id}  ${p.name}  (updated ${new Date(p.updatedAt).toISOString()})`)
    }
    return
  }

  if (!args.project) throw new Error('Missing --project <id|project.json>')

  const { project, projectJsonPath } = loadProject(workspace, args.project)
  console.log(`Project: ${project.name ?? project.id} (${projectJsonPath})`)

  const settings = buildSettings(project, args)
  console.log(
    `Output: ${settings.mode} ${settings.codec}/${settings.container} ` +
      `${settings.resolution.width}x${settings.resolution.height}@${settings.fps}`,
  )

  // Optional render range (frames), from --in / --out-sec / --duration seconds.
  const fps = settings.fps
  const hasRange = args.in !== undefined || args['out-sec'] !== undefined || args.duration !== undefined
  let inPoint = null
  let outPoint = null
  if (hasRange) {
    const inSec = args.in !== undefined ? Number(args.in) : 0
    const outSec =
      args['out-sec'] !== undefined
        ? Number(args['out-sec'])
        : args.duration !== undefined
          ? inSec + Number(args.duration)
          : undefined
    inPoint = Math.round(inSec * fps)
    outPoint = outSec !== undefined ? Math.round(outSec * fps) : null
    console.log(`Range: frames ${inPoint}..${outPoint ?? 'end'} (${inSec}s..${outSec ?? 'end'}s)`)
  }

  // Resolve referenced media to files on disk (only media overlapping the range).
  const mediaIds = collectMediaIds(
    project,
    hasRange ? { inFrame: inPoint ?? 0, outFrame: outPoint ?? Number.POSITIVE_INFINITY } : null,
  )
  const { files, missing } = resolveMediaFiles(workspace, mediaIds)
  if (missing.length > 0) {
    console.warn(
      `WARNING: ${missing.length} media source(s) not found on disk: ${missing.join(', ')}\n` +
        `  Open the project in the FreeCut app once so media is mirrored into the workspace folder.`,
    )
  }
  console.log(`Media: ${files.size}/${mediaIds.length} resolved`)

  // Serve the harness + media. Default: standalone server over the built dist/.
  // Dev mode (--harness-url): drive a running Vite dev server + a cross-origin
  // media server.
  const { harnessUrl, mediaUrlOf, closeServers } = await startServers(args, files)
  const media = [...files.keys()].map((mediaId) => ({ mediaId, url: mediaUrlOf(mediaId) }))
  console.log(`Harness: ${harnessUrl}`)

  const outName = `${(project.name ?? 'freecut-export').replace(/[^\w.-]+/g, '_')}.${settings.container}`
  const outPath = path.resolve(args.out ?? path.join('headless', 'output', outName))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.head,
    args: GPU_ARGS,
  })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Video load error')) {
        console.error('  [page:error]', m.text())
      }
    })

    let lastPct = -1
    await page.exposeBinding('__freecutProgress', (_src, progress) => {
      const pct = Math.floor(progress?.progress ?? 0)
      if (pct !== lastPct) {
        lastPct = pct
        process.stdout.write(`\r  ${(progress?.phase ?? 'render').padEnd(10)} ${pct}%   `)
      }
    })

    await page.goto(harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    console.log('Harness ready. Rendering...')

    const downloadPromise = page.waitForEvent('download', { timeout: 30 * 60_000 })
    // Avoid an unhandled rejection if the render throws and we close the page.
    downloadPromise.catch(() => {})
    const summary = await page.evaluate((payload) => window.freecut.renderProject(payload), {
      project,
      settings,
      media,
      renderWholeProject: !hasRange,
      inPoint,
      outPoint,
    })
    process.stdout.write('\n')

    const download = await downloadPromise
    await download.saveAs(outPath)
    console.log(`Done: ${outPath}`)
    console.log(
      `  ${summary.mimeType}, ${(summary.fileSize / 1_000_000).toFixed(2)} MB, ${summary.durationSeconds.toFixed(2)}s`,
    )
  } finally {
    await browser.close()
    await closeServers()
  }
}

main().catch((e) => {
  console.error('\nRender failed:', e.message ?? e)
  process.exit(1)
})
