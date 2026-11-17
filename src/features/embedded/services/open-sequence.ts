import { createLogger } from '@/shared/logging/logger'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useSequencesStore,
} from '../deps/timeline-contract'
import { editRequestPending } from './edit-ops-bridge'
import { editBlocker } from './edit-readiness'

const log = createLogger('embedded-open-sequence')

/** The tab a parent names: null for 'main', the id of a sequence tab, or undefined when there is none. */
function tabFor(sequenceId: unknown): string | null | undefined {
  if (sequenceId === 'main') return null
  if (typeof sequenceId !== 'string' || sequenceId.length === 0) return undefined
  const isTab =
    useSequencesStore.getState().topLevelSequenceIds.includes(sequenceId) &&
    !!useCompositionsStore.getState().compositionById[sequenceId]
  return isTab ? sequenceId : undefined
}

/**
 * NODARO_PLAYBACK { action: 'open-sequence', sequenceId }: open that timeline
 * tab, `'main'` for Main, as clicking the tab does. Undo history is kept per
 * tab, so it is refused while an edit request is waiting or being applied, and
 * while the editor is busy (loading, importing, a drag held down). No reply:
 * the timeline report's `sequences[].active` says which tab is open.
 */
export function openSequence(sequenceId: unknown): boolean {
  const tab = tabFor(sequenceId)
  if (tab === undefined) {
    log.warn(`open-sequence: "${String(sequenceId)}" is not a timeline tab`)
    return false
  }
  if (editRequestPending()) {
    log.warn('open-sequence refused: an edit request is not finished')
    return false
  }
  const blocker = editBlocker()
  if (blocker) {
    log.warn(`open-sequence refused: ${blocker}`)
    return false
  }
  useCompositionNavigationStore.getState().switchToSequence(tab)
  return true
}
