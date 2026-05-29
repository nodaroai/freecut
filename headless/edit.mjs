// FreeCut headless edit CLI.
//
// Applies a list of edit ops to a project by driving the real timeline action
// modules inside headless Chrome (via window.freecut.editProject), then writes
// the edited project back out. No rendering, no media needed.
//
// Usage:
//   node headless/edit.mjs --workspace <dir> --project <id|project.json> --ops <ops.json> [--out <path> | --in-place]
//
// Options:
//   --ops <file.json>   JSON file with an array of edit ops (or a single op object)
//   --out <path>        Write the edited project JSON here
//   --in-place          Overwrite the source project.json (destructive — explicit opt-in)
//   --build             Build dist/ first if the harness isn't built
//   --harness-url <url> Dev mode: drive a running Vite dev server instead of dist/
//   --head              Run headed (visible browser) for debugging
//
// With neither --out nor --in-place this is a DRY RUN: it applies the ops and
// prints the result summary without writing anything.
//
// Ops (JSON): each is { "op": "<name>", ... }
//   addText      { text, from, durationInFrames, trackId?, color?, fontSize?, fontWeight?, textAlign?, verticalAlign? }
//   addItem      { item: <full TimelineItem> }
//   updateItem   { id, updates: <partial TimelineItem> }
//   moveItem     { id, from, trackId? }
//   removeItems  { ids: [<id>...] }
//   split        { id, frame }
//   trimStart    { id, amount }
//   trimEnd      { id, amount }
//   addTransition{ leftClipId, rightClipId, type?, durationInFrames? }
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { loadProject } from './lib/workspace.mjs'
import { createHarnessServer } from './server.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else {
        args[key] = next
        i++
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

function loadOps(args) {
  if (!args.ops) throw new Error('Missing --ops <file.json>')
  const opsPath = path.resolve(args.ops)
  if (!fs.existsSync(opsPath)) throw new Error(`Ops file not found: ${opsPath}`)
  const parsed = JSON.parse(fs.readFileSync(opsPath, 'utf8'))
  const ops = Array.isArray(parsed) ? parsed : [parsed]
  if (ops.length === 0) throw new Error('Ops file is empty')
  return ops
}

async function startHarness(args) {
  const devUrl = args['harness-url']
  if (devUrl) {
    try {
      const res = await fetch(devUrl, { method: 'HEAD' })
      if (!res.ok) throw new Error()
    } catch {
      throw new Error(`Dev harness not reachable at ${devUrl}. Start it with: npm run dev`)
    }
    return { harnessUrl: devUrl, close: async () => {} }
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
  const server = await createHarnessServer({ distDir, mediaFiles: new Map() })
  return { harnessUrl: server.harnessUrl, close: () => server.close() }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workspace) throw new Error('Missing --workspace <dir>')
  if (!args.project) throw new Error('Missing --project <id|project.json>')

  const ops = loadOps(args)
  const { project, projectJsonPath } = loadProject(args.workspace, args.project)
  console.log(`Project: ${project.name ?? project.id} (${projectJsonPath})`)
  console.log(`Ops: ${ops.length}`)

  const { harnessUrl, close } = await startHarness(args)
  const browser = await chromium.launch({ channel: 'chrome', headless: !args.head })
  let result
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) {
        console.error('  [page:error]', m.text())
      }
    })
    await page.goto(harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })
    result = await page.evaluate((payload) => window.freecut.editProject(payload), { project, ops })
  } finally {
    await browser.close()
    await close()
  }

  console.log('\nApplied ops:')
  for (const r of result.results) {
    console.log(`  ${r.ok ? 'ok ' : 'ERR'} ${r.op}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`)
  }
  const edited = result.project
  const itemCount = edited.timeline?.items?.length ?? 0
  console.log(`Result: ${itemCount} items, ${edited.timeline?.tracks?.length ?? 0} tracks`)

  // Write back (safe by default: dry run unless --out or --in-place).
  let outPath = null
  if (args.out) outPath = path.resolve(args.out)
  else if (args['in-place']) outPath = projectJsonPath

  if (!outPath) {
    console.log('\nDRY RUN (no --out / --in-place): nothing written.')
    return
  }

  const toWrite = { ...edited, updatedAt: Date.now() }
  fs.writeFileSync(outPath, JSON.stringify(toWrite, null, 2))
  console.log(`\nWrote: ${outPath}`)
}

main().catch((e) => {
  console.error('\nEdit failed:', e.message ?? e)
  process.exit(1)
})
