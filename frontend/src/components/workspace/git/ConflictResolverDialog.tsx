import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, Loader2 } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { abortOperation, continueOperation, getRepoState, skipOperation, fileAtCommit } from '@/lib/git/gitService'
import type { OpResult } from '@/lib/git/types'
import { DiffModal } from '@/components/response/DiffView'

interface ConflictResolverDialogProps {
  repoPath: string
  operation: string
  initialConflicts: string[]
  onResolved: (res: OpResult) => void
  onClose: () => void
}

// Ref holding "their" side per in-progress operation.
const THEIRS_REF: Record<string, string> = {
  merge: 'MERGE_HEAD',
  'cherry-pick': 'CHERRY_PICK_HEAD',
  revert: 'REVERT_HEAD',
  rebase: 'REBASE_HEAD',
}

/**
 * Conflict resolution workflow shared by merge/rebase/cherry-pick/revert. Lets
 * the user take ours/theirs, stage a manual resolution, inspect ours-vs-theirs,
 * then continue / skip / abort the sequencer operation.
 */
export function ConflictResolverDialog({ repoPath, operation, initialConflicts, onResolved, onClose }: ConflictResolverDialogProps) {
  const [conflicts, setConflicts] = useState<string[]>(initialConflicts)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [diff, setDiff] = useState<{ path: string; ours: string; theirs: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const state = await getRepoState(repoPath)
      setConflicts(state.conflictedFiles)
      return state.operation
    } catch (e) {
      setError(String(e))
      return operation
    }
  }, [repoPath, operation])

  const act = async (path: string, fn: () => Promise<void>) => {
    setBusy(path)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }

  const useOurs = (path: string) => act(path, async () => {
    await GitSync.CheckoutConflictSide(repoPath, path, 'ours')
    await GitSync.StageFile(repoPath, path)
  })
  const useTheirs = (path: string) => act(path, async () => {
    await GitSync.CheckoutConflictSide(repoPath, path, 'theirs')
    await GitSync.StageFile(repoPath, path)
  })
  const markResolved = (path: string) => act(path, () => GitSync.StageFile(repoPath, path))

  const viewDiff = async (path: string) => {
    setBusy(path)
    try {
      const theirsRef = THEIRS_REF[operation] || 'MERGE_HEAD'
      const [ours, theirs] = await Promise.all([
        fileAtCommit(repoPath, 'HEAD', path).catch(() => ''),
        fileAtCommit(repoPath, theirsRef, path).catch(() => ''),
      ])
      setDiff({ path, ours, theirs })
    } finally {
      setBusy('')
    }
  }

  const finish = async (fn: () => Promise<OpResult>) => {
    setBusy('__op__')
    setError('')
    try {
      const res = await fn()
      if (res.success) onResolved(res)
      else {
        setError(res.error || 'Operation could not complete.')
        await refresh()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => { void refresh() }, [refresh])

  const unresolved = conflicts.length
  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-xl border border-warning/40 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-1 bg-warning/10 px-4 py-3">
          <AlertTriangle size={15} className="text-warning" />
          <div className="text-sm font-semibold text-text-1">Resolve conflicts</div>
          <span className="ml-auto rounded border border-border-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3">{operation || 'merge'}</span>
        </div>

        {error && <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {unresolved === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-success"><Check size={14} /> All conflicts resolved — continue to finish.</div>
          ) : (
            <div className="space-y-1.5">
              {conflicts.map((path) => (
                <div key={path} className="rounded border border-warning/40 bg-warning/5 p-2">
                  <div className="mb-2 truncate font-mono text-xs text-text-1" title={path}>{path}</div>
                  <div className="grid grid-cols-4 gap-1">
                    <button disabled={!!busy} onClick={() => useOurs(path)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">Ours</button>
                    <button disabled={!!busy} onClick={() => useTheirs(path)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">Theirs</button>
                    <button disabled={!!busy} onClick={() => markResolved(path)} className="rounded border border-accent/50 px-2 py-1 text-[10px] text-accent disabled:opacity-40">Mark resolved</button>
                    <button disabled={busy === path} onClick={() => void viewDiff(path)} className="flex items-center justify-center gap-1 rounded border border-border-2 px-2 py-1 text-[10px] text-text-3 hover:text-text-1 disabled:opacity-40">
                      {busy === path ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button onClick={onClose} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1">Close</button>
          <button disabled={!!busy} onClick={() => void finish(() => abortOperation(repoPath))} className="h-7 rounded border border-error/40 px-3 text-xs text-error hover:bg-error/10 disabled:opacity-40">Abort</button>
          <button disabled={!!busy} onClick={() => void finish(() => skipOperation(repoPath))} className="h-7 rounded border border-border-2 px-3 text-xs text-text-2 hover:bg-surface-2 disabled:opacity-40">Skip</button>
          <button disabled={!!busy || unresolved > 0} onClick={() => void finish(() => continueOperation(repoPath))} title={unresolved > 0 ? 'Resolve all conflicts first' : undefined} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">
            {busy === '__op__' && <Loader2 size={12} className="animate-spin" />} Continue
          </button>
        </div>
      </div>

      {diff && (
        <DiffModal
          title={`Conflict — ${diff.path}`}
          leftLabel="Ours (HEAD)"
          rightLabel="Theirs (incoming)"
          leftBody={diff.ours}
          rightBody={diff.theirs}
          onClose={() => setDiff(null)}
        />
      )}
    </div>
  )
}
