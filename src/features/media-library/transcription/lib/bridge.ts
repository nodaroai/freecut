import type {
  MainThreadMessage,
  PCMChunk,
  QuantizationType,
  TranscriptSegment,
  TranscribeProgress,
  TranscribeRuntimeInfo,
  TranscriptionEngine,
  WhisperModel,
} from '../types'
import { MODEL_IDS } from '../types'
import { createManagedWorkerSession } from '@/shared/utils/managed-worker-session'
import { Chunker } from './chunker'
import { downmixToMono, resampleTo16kHz } from './resampler'
import { DEFAULT_WHISPER_MODEL } from '@/shared/utils/whisper-settings'
import {
  acquireParakeetWorker,
  releaseParakeetWorker,
  disposeParakeetWorker,
} from './parakeet-worker-host'

export interface BridgeCallbacks {
  onSegment: (segment: TranscriptSegment) => void
  onProgress: (event: TranscribeProgress) => void
  onRuntimeInfo: (info: TranscribeRuntimeInfo) => void
  onDone: () => void
  onError: (message: string) => void
}

export class Bridge {
  private readonly callbacks: BridgeCallbacks
  private readonly session = createManagedWorkerSession({
    decoder: {
      createWorker: () =>
        new Worker(new URL('../workers/decoder.worker.ts', import.meta.url), { type: 'module' }),
      setupWorker: (worker) => {
        worker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
          this.handleDecoderMessage(event.data)
        }

        worker.onerror = (event) => {
          this.callbacks.onError(`Decoder worker: ${event.message ?? 'unknown error'}`)
          this.terminate()
        }

        return () => {
          worker.onmessage = null
          worker.onerror = null
        }
      },
    },
    whisper: {
      createWorker: () =>
        new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' }),
      setupWorker: (worker) => {
        worker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
          this.handleTranscriptionMessage(event.data)
        }

        worker.onerror = (event) => {
          this.callbacks.onError(`Whisper worker: ${event.message ?? 'unknown error'}`)
          this.terminate()
        }

        return () => {
          worker.onmessage = null
          worker.onerror = null
        }
      },
    },
  })

  // Which transcription worker is driving the active job (whisper.worker / parakeet.worker).
  private activeWorker: 'whisper' | 'parakeet' = 'whisper'
  // The Parakeet worker is shared/persistent (its 1.24 GB encoder is expensive to compile),
  // so it lives outside the per-job managed session — see parakeet-worker-host.
  private parakeetWorker: Worker | null = null
  private detachParakeet: (() => void) | null = null
  private torndown = false

  constructor(callbacks: BridgeCallbacks) {
    this.callbacks = callbacks
  }

  async start(
    file: File,
    model: WhisperModel = DEFAULT_WHISPER_MODEL,
    language?: string,
    quantization?: QuantizationType,
    engine: TranscriptionEngine = 'whisper',
  ): Promise<void> {
    const { port1, port2 } = new MessageChannel()
    const modelId = MODEL_IDS[model]
    const hasWebCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window
    this.activeWorker = engine === 'parakeet' ? 'parakeet' : 'whisper'

    const transcriptionWorker =
      this.activeWorker === 'parakeet'
        ? this.attachParakeetWorker()
        : this.session.getWorker('whisper')

    if (hasWebCodecs) {
      this.session.getWorker('decoder').postMessage({ type: 'port', port: port1 }, [port1])
    }

    this.session.registerCleanup(() => {
      port1.onmessage = null
      port2.onmessage = null
      port1.close()
      port2.close()
    })

    transcriptionWorker.postMessage({ type: 'port', port: port2 }, [port2])
    transcriptionWorker.postMessage({ type: 'init', modelId, language, quantization })

    if (hasWebCodecs) {
      this.session.getWorker('decoder').postMessage({ type: 'init', file })
      return
    }

    void this.decodeWithAudioContext(file, port1)
  }

  // Attach this job's message handlers to the shared, persistent Parakeet worker without
  // taking ownership of its lifecycle (it survives across jobs to avoid recompiling).
  private attachParakeetWorker(): Worker {
    const worker = acquireParakeetWorker()
    this.parakeetWorker = worker
    const onMessage = (event: MessageEvent<MainThreadMessage>) => {
      this.handleTranscriptionMessage(event.data)
    }
    const onError = (event: ErrorEvent) => {
      this.callbacks.onError(`Parakeet worker: ${event.message ?? 'unknown error'}`)
      this.teardown(true)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    this.detachParakeet = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    return worker
  }

  // Tear down the job. `disposeShared` controls whether the persistent Parakeet worker is
  // also destroyed (true on error/cancel) or kept warm for the next job (false on clean done).
  private teardown(disposeShared: boolean): void {
    if (this.torndown) {
      return
    }
    this.torndown = true

    this.detachParakeet?.()
    this.detachParakeet = null
    if (this.parakeetWorker) {
      this.parakeetWorker = null
      if (disposeShared) {
        disposeParakeetWorker()
      } else {
        releaseParakeetWorker()
      }
    }

    if (!this.session.isTerminated()) {
      this.session.terminate()
    }
  }

  terminate(): void {
    this.teardown(true)
  }

  setPaused(paused: boolean): void {
    if (this.torndown || this.session.isTerminated()) {
      return
    }

    const message = { type: paused ? 'pause' : 'resume' } as const
    const transcriptionWorker =
      this.activeWorker === 'parakeet' ? this.parakeetWorker : this.session.getWorker('whisper')
    transcriptionWorker?.postMessage(message)
    const hasWebCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window
    if (hasWebCodecs) {
      this.session.getWorker('decoder').postMessage(message)
    }
  }

  private async decodeWithAudioContext(file: File, port: MessagePort): Promise<void> {
    try {
      this.callbacks.onProgress({ stage: 'decoding', progress: 0 })

      const arrayBuffer = await file.arrayBuffer()
      const AudioContextClass =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) {
        throw new Error('AudioContext is not available in this browser')
      }

      const audioContext = new AudioContextClass()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      this.callbacks.onProgress({ stage: 'decoding', progress: 0.5 })

      const channels: Float32Array[] = []
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i))
      }

      const mono = downmixToMono(channels)
      const resampled = resampleTo16kHz(mono, audioBuffer.sampleRate)

      let whisperQueueSize = 0
      let whisperQueueWaiter: (() => void) | null = null

      port.onmessage = (event: MessageEvent<number>) => {
        whisperQueueSize = event.data
        if (whisperQueueSize < 3 && whisperQueueWaiter) {
          whisperQueueWaiter()
          whisperQueueWaiter = null
        }
      }

      const chunker = new Chunker((chunk: PCMChunk) => {
        if (this.session.isTerminated()) {
          return
        }
        port.postMessage(chunk, [chunk.samples.buffer])
      })

      const samplesPerChunk = 16_000 * 30
      for (let i = 0; i < resampled.length; i += samplesPerChunk) {
        if (this.session.isTerminated()) {
          break
        }

        while (whisperQueueSize >= 3) {
          await new Promise<void>((resolve) => {
            whisperQueueWaiter = resolve
          })
        }

        if (this.session.isTerminated()) {
          break
        }

        const chunk = resampled.subarray(i, i + samplesPerChunk)
        chunker.push(chunk)
      }

      if (!this.session.isTerminated()) {
        chunker.flush()
        this.callbacks.onProgress({ stage: 'decoding', progress: 1 })
      }

      await audioContext.close()
    } catch (error) {
      this.callbacks.onError(
        `Decoder fallback error: ${error instanceof Error ? error.message : String(error)}`,
      )
      this.terminate()
    }
  }

  private handleTranscriptionMessage(message: MainThreadMessage): void {
    if (this.torndown) {
      return
    }

    switch (message.type) {
      case 'segment':
        this.callbacks.onSegment(message.segment)
        break
      case 'progress':
        this.callbacks.onProgress(message.event)
        break
      case 'runtime':
        this.callbacks.onRuntimeInfo(message.info)
        break
      case 'done':
        this.callbacks.onDone()
        // Keep the shared Parakeet worker warm for the next job; whisper's per-job worker
        // is torn down with the managed session.
        this.teardown(false)
        break
      case 'error':
        this.callbacks.onError(message.message)
        this.teardown(true)
        break
      default:
        break
    }
  }

  private handleDecoderMessage(message: MainThreadMessage): void {
    if (this.session.isTerminated()) {
      return
    }

    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.event)
        break
      case 'error':
        this.callbacks.onError(`Decoder: ${message.message}`)
        this.terminate()
        break
      default:
        break
    }
  }
}
