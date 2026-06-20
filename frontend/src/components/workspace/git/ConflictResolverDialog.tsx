import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Eye, Loader2, Save, X } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { abortOperation, continueOperation, getRepoState, skipOperation } from '@/lib/git/gitService'
import type { OpResult } from '@/lib/git/types'

interface ConflictResolverDialogProps {
  repoPath: string
  operation: string
  initialConflicts: string[]
  onResolved: (res: OpResult) => void
  onClose: () => void
}

interface ConflictVersions {
  path: string
  base: string
  ours: string
  theirs: string
  result: string
  baseAvailable: boolean
  oursAvailable: boolean
  theirsAvailable: boolean
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
  const [editor, setEditor] = useState<ConflictVersions | null>(null)

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

  const openEditor = async (path: string) => {
    setBusy(path)
    setError('')
    try {
      setEditor(JSON.parse(await GitSync.GetConflictFileVersions(repoPath, path)) as ConflictVersions)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }

  const saveResolution = async () => {
    if (!editor) return
    setBusy(editor.path)
    setError('')
    try {
      await GitSync.SaveConflictResolution(repoPath, editor.path, editor.result)
      setEditor(null)
      await refresh()
    } catch (e) {
      setError(String(e))
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
                    <button disabled={busy === path} onClick={() => void openEditor(path)} className="flex items-center justify-center gap-1 rounded border border-border-2 px-2 py-1 text-[10px] text-text-3 hover:text-text-1 disabled:opacity-40">
                      {busy === path ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Three-way
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

      {editor && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-5" onClick={() => setEditor(null)}>
          <div className="flex h-[min(86vh,900px)] w-[min(94vw,1500px)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 px-4">
              <span className="text-sm font-semibold text-text-1">Three-way conflict editor</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-3" title={editor.path}>{editor.path}</span>
              <button onClick={() => setEditor(null)} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={15} /></button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-border-1">
              {([
                ['Base', editor.base, editor.baseAvailable, 'base'],
                ['Ours', editor.ours, editor.oursAvailable, 'ours'],
                ['Theirs', editor.theirs, editor.theirsAvailable, 'theirs'],
              ] as const).map(([label, content, available, key]) => (
                <div key={key} className="flex min-w-0 flex-col">
                  <div className="flex h-9 items-center justify-between border-b border-border-1 bg-surface-0 px-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">{label}</span>
                    <button disabled={!available} onClick={() => setEditor((current) => current ? { ...current, result: content } : current)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-30">Use in result</button>
                  </div>
                  <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-5 text-text-2">{available ? content : '(file does not exist on this side)'}</pre>
                </div>
              ))}
            </div>
            <div className="flex min-h-[220px] flex-[.75] flex-col border-t border-border-2">
              <div className="flex h-9 shrink-0 items-center justify-between bg-accent/10 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Merged result — editable</span>
                <span className="text-[10px] text-text-4">Saving writes and stages the file</span>
              </div>
              <textarea value={editor.result} onChange={(e) => setEditor({ ...editor, result: e.target.value })} spellCheck={false} className="min-h-0 flex-1 resize-none border-0 bg-surface-0 p-3 font-mono text-[11px] leading-5 text-text-1 outline-none" />
            </div>
            <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-border-1 px-4">
              <button onClick={() => setEditor(null)} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3">Cancel</button>
              <button disabled={!!busy} onClick={() => void saveResolution()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">
                {busy === editor.path ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
