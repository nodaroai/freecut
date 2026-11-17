import {
  captureSnapshot,
  restoreSnapshot,
  snapshotsEqual,
  useTimelineCommandStore,
} from '../deps/timeline-contract'

type CommandState = ReturnType<typeof useTimelineCommandStore.getState>
type Entry = CommandState['undoStack'][number]
type Snapshot = Entry['beforeSnapshot']
type Command = Entry['command']

/** A request that ran without history changed more than whole timeline tabs. */
export class HistoryFreeRefusal extends Error {}

/** Which timeline tabs a request added and removed: the only change a request without history may make. */
interface TabChange {
  readonly added: Snapshot['compositions']
  readonly removedIds: ReadonlySet<string>
  readonly tabsAdded: readonly string[]
  readonly tabsRemoved: ReadonlySet<string>
}

function tabChange(before: Snapshot, after: Snapshot): TabChange | null {
  // Everything but the sequence registry and the tab list must be untouched...
  const withAfterTabs = {
    ...before,
    compositions: after.compositions,
    topLevelSequenceIds: after.topLevelSequenceIds,
  }
  if (!snapshotsEqual(withAfterTabs, after)) return null
  // ...and a sequence in both must be the same one: only whole tabs come and go.
  const beforeById = new Map(before.compositions.map((c) => [c.id, c]))
  const afterIds = new Set(after.compositions.map((c) => c.id))
  if (after.compositions.some((c) => beforeById.has(c.id) && beforeById.get(c.id) !== c))
    return null
  return {
    added: after.compositions.filter((c) => !beforeById.has(c.id)),
    removedIds: new Set(before.compositions.filter((c) => !afterIds.has(c.id)).map((c) => c.id)),
    tabsAdded: after.topLevelSequenceIds.filter((id) => !before.topLevelSequenceIds.includes(id)),
    tabsRemoved: new Set(
      before.topLevelSequenceIds.filter((id) => !after.topLevelSequenceIds.includes(id)),
    ),
  }
}

/** A saved undo or redo state with the same tabs added and removed. */
function rebase(snapshot: Snapshot, change: TabChange): Snapshot {
  const addedIds = new Set(change.added.map((c) => c.id))
  const tabsAdded = new Set(change.tabsAdded)
  return {
    ...snapshot,
    compositions: [
      ...snapshot.compositions.filter((c) => !change.removedIds.has(c.id) && !addedIds.has(c.id)),
      ...change.added,
    ],
    topLevelSequenceIds: [
      ...snapshot.topLevelSequenceIds.filter(
        (id) => !change.tabsRemoved.has(id) && !tabsAdded.has(id),
      ),
      ...change.tabsAdded,
    ],
  }
}

const rebaseEntries = (entries: readonly Entry[], change: TabChange): Entry[] =>
  entries.map((entry) => ({ ...entry, beforeSnapshot: rebase(entry.beforeSnapshot, change) }))

/**
 * Run a request as one batch that leaves no undo entry (NODARO_APPLY_OPS with
 * `history: false`), for adding and removing timeline tabs that are not open:
 * such a tab is not an edit of the open timeline, so it must not sit on its
 * undo stack. Undo states capture the tabs too, so every saved undo and redo
 * state (of every tab) gets the same change: undoing an earlier edit never
 * takes a new tab away or brings a removed one back. A request that changed
 * anything else is taken back and refused. A failing operation rolls the
 * request back, as in any batch.
 */
export function executeWithoutHistory<T>(command: Command, action: () => T): T {
  const store = useTimelineCommandStore.getState()
  const saved = {
    undoStack: store.undoStack,
    redoStack: store.redoStack,
    stacksByContext: store.stacksByContext,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
  }
  const before = captureSnapshot()
  const result = store.executeBatch(command, action)
  const change = tabChange(before, captureSnapshot())
  if (!change) {
    restoreSnapshot(before)
    useTimelineCommandStore.setState(saved)
    throw new HistoryFreeRefusal(
      'history: false only adds or removes timeline tabs that are not open; this request changed more',
    )
  }
  // The batch may have dropped a removed tab's own parked history: keep that.
  const parked = useTimelineCommandStore.getState().stacksByContext
  useTimelineCommandStore.setState({
    ...saved,
    undoStack: rebaseEntries(saved.undoStack, change),
    redoStack: rebaseEntries(saved.redoStack, change),
    stacksByContext: Object.fromEntries(
      Object.entries(parked).map(([key, stacks]) => [
        key,
        {
          undoStack: rebaseEntries(stacks.undoStack, change),
          redoStack: rebaseEntries(stacks.redoStack, change),
        },
      ]),
    ),
  })
  return result
}
