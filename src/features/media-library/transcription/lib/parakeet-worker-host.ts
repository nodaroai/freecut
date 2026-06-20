// Parakeet's encoder is a 1.24 GB WebGPU model that takes ~20s to compile. Unlike the tiny
// Whisper models, recompiling it per job is the dominant cost, so the worker (and its
// compiled ONNX sessions) is kept resident and reused across transcription jobs. After a
// period with no active job it is evicted to release the GPU/host memory it holds.

let worker: Worker | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

const IDLE_EVICT_MS = 120_000

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/** Get the shared Parakeet worker, creating it (and cancelling any pending eviction). */
export function acquireParakeetWorker(): Worker {
  clearIdleTimer()
  if (!worker) {
    worker = new Worker(new URL('../workers/parakeet.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return worker
}

/** Mark the worker idle: keep it warm briefly, then evict to free memory. */
export function releaseParakeetWorker(): void {
  if (!worker) return
  clearIdleTimer()
  idleTimer = setTimeout(disposeParakeetWorker, IDLE_EVICT_MS)
}

/** Tear the worker down immediately (errors, cancellation, explicit unload). */
export function disposeParakeetWorker(): void {
  clearIdleTimer()
  worker?.terminate()
  worker = null
}
