export interface WorkspaceHistoryFile {
  documentId: string
  relativePath: string
  before: string
  after: string
}

export interface WorkspaceHistoryEntry {
  label: string
  files: WorkspaceHistoryFile[]
}

export interface WorkspaceHistory {
  undo: WorkspaceHistoryEntry[]
  redo: WorkspaceHistoryEntry[]
}

export const emptyWorkspaceHistory = (): WorkspaceHistory => ({ undo: [], redo: [] })

const MAX_ENTRIES = 10
const MAX_BYTES = 16 * 1024 * 1024
const bytes = (entry: WorkspaceHistoryEntry) => entry.files.reduce((sum, file) => sum + 2 * (file.before.length + file.after.length), 0)

export function recordWorkspaceChange(history: WorkspaceHistory, entry: WorkspaceHistoryEntry): WorkspaceHistory {
  const undo = [...history.undo, entry].slice(-MAX_ENTRIES)
  let size = undo.reduce((sum, item) => sum + bytes(item), 0)
  while (undo.length && size > MAX_BYTES) size -= bytes(undo.shift()!)
  return { undo, redo: [] }
}

export function moveWorkspaceHistory(history: WorkspaceHistory, redo: boolean): WorkspaceHistory {
  const source = redo ? history.redo : history.undo
  const entry = source[source.length - 1]
  if (!entry) return history
  return redo
    ? { undo: [...history.undo, entry], redo: history.redo.slice(0, -1) }
    : { undo: history.undo.slice(0, -1), redo: [...history.redo, entry] }
}

/** Refuse the whole operation when even one target no longer matches the recorded snapshot. */
export function workspaceHistoryConflicts(entry: WorkspaceHistoryEntry, buffers: ReadonlyMap<string, string>, redo: boolean): string[] {
  return entry.files.filter(file => buffers.get(file.documentId) !== (redo ? file.before : file.after)).map(file => file.relativePath)
}
