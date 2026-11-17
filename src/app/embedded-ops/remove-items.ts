/**
 * `removeItems { ids }`: remove exactly these items, and answer `{ removed }`.
 *
 * A parent names the items it means. The editor's own delete also takes the
 * items linked to them (a clip's sound, the captions laid on a clip) when
 * linked selection is on, which is right for a person's selection and wrong
 * here: replacing the captions of a clip must not delete the clip. So linked
 * selection is off for the length of this one removal.
 */
import type { EditOp } from '@/features/embedded/services/edit-ops-bridge'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { removeItems } from '@/features/timeline/stores/timeline-actions'
import { useEditorStore } from '@/shared/state/editor'
import { fail } from './op-fields'

export function applyRemoveItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids)
    ? op.ids.filter((id): id is string => typeof id === 'string')
    : []
  if (ids.length === 0) fail(op, 'needs a non-empty `ids` list')
  const known = new Set(useItemsStore.getState().items.map((item) => item.id))
  const missing = ids.find((id) => !known.has(id))
  if (missing) fail(op, `no item ${missing} is on the timeline`)

  const linked = useEditorStore.getState().linkedSelectionEnabled
  useEditorStore.setState({ linkedSelectionEnabled: false })
  try {
    removeItems(ids)
  } finally {
    useEditorStore.setState({ linkedSelectionEnabled: linked })
  }
  return { removed: ids }
}
