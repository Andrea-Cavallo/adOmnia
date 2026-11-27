import { describe, expect, it } from 'vitest'
import { emptyWorkspaceHistory, moveWorkspaceHistory, recordWorkspaceChange, workspaceHistoryConflicts, type WorkspaceHistoryEntry } from './workspaceHistory'

const entry: WorkspaceHistoryEntry = { label: 'Rename', files: [
  { documentId: 'a', relativePath: 'a.ts', before: 'old', after: 'new' },
  { documentId: 'b', relativePath: 'b.py', before: 'old()', after: 'new()' },
] }

describe('workspace history', () => {
  it('moves an entire transaction between undo and redo', () => {
    const recorded = recordWorkspaceChange(emptyWorkspaceHistory(), entry)
    const undone = moveWorkspaceHistory(recorded, false)
    expect(undone).toEqual({ undo: [], redo: [entry] })
    expect(moveWorkspaceHistory(undone, true)).toEqual(recorded)
  })
  it('refuses subsequent edits and closed documents as a single operation', () => {
    expect(workspaceHistoryConflicts(entry, new Map([['a', 'new'], ['b', 'user edit']]), false)).toEqual(['b.py'])
    expect(workspaceHistoryConflicts(entry, new Map([['a', 'old']]), true)).toEqual(['b.py'])
    expect(workspaceHistoryConflicts(entry, new Map([['a', 'old'], ['b', 'old()']]), true)).toEqual([])
  })
  it('clears redo on a new change and bounds retained snapshots', () => {
    let history = moveWorkspaceHistory(recordWorkspaceChange(emptyWorkspaceHistory(), entry), false)
    for (let index = 0; index < 15; index++) history = recordWorkspaceChange(history, { ...entry, label: `${index}` })
    expect(history.redo).toEqual([])
    expect(history.undo).toHaveLength(10)
    expect(history.undo[0].label).toBe('5')
  })
})
