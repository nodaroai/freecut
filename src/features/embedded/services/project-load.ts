// The newest NODARO_LOAD_VIDEO still running.
let pendingLoad: Promise<void> | null = null

/** Records a NODARO_LOAD_VIDEO while it runs; answers the same promise. */
export function trackProjectLoad(load: Promise<void>): Promise<void> {
  pendingLoad = load
  const settle = () => {
    if (pendingLoad === load) pendingLoad = null
  }
  load.then(settle, settle)
  return load
}

/** Settles once the newest NODARO_LOAD_VIDEO has ended; null when none is running. */
export function projectLoadInProgress(): Promise<void> | null {
  return pendingLoad
}
