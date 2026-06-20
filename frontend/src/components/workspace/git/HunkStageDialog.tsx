import { useCallback, useEffect, useState } from 'react'
import { Loader2, Scissors } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { buildPatch, parseFileDiff, selectHunkLines, type Hunk } from '@/lib/git/hunks'
import { cn } from '@/lib/utils'

interface HunkStageDialogProps {
  repoPath: string
  path: string
  /** 'stage' = move selected hunks worktree→index; 'unstage' = index→worktree. */
  mode: 'stage' | 'unstage'
  onDone: () => void
  onClose: () => void
}

function lineClass(line: string): string {
  if (line.startsWith('+')) return 'text-success'
  if (line.startsWith('-')) return 'text-error'
  if (line.startsWith('@@')) return 'text-accent'
  return 'text-text-3'
}

export function HunkStageDialog({ repoPath, path, mode, onDone, onClose }: HunkStageDialogProps) {
  const staged = mode === 'unstage'
  const [fileHeader, setFileHeader] = useState('')
  const [hunks, setHunks] = useState<Hunk[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [selectedLines, setSelectedLines] = useState<Map<number, Set<number>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const diff = await GitSync.FileDiff(repoPath, path, staged)
      const parsed = parseFileDiff(diff)
      setFileHeader(parsed.fileHeader)
      setHunks(parsed.hunks)
      setSelected(new Set(parsed.hunks.map((_, i) => i)))
      setSelectedLines(new Map())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [repoPath, path, staged])

  useEffect(() => { void load() }, [load])

  const toggle = (i: number) => {
    setSelectedLines((previous) => { const next = new Map(previous); next.delete(i); return next })
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const changedLineIndexes = (hunk: Hunk) => hunk.lines
    .map((line, index) => ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---') ? index : -1))
    .filter((index) => index >= 0)

  const toggleLine = (hunkIndex: number, lineIndex: number) => {
    setSelectedLines((previous) => {
      const next = new Map(previous)
      const current = new Set(next.get(hunkIndex) ?? changedLineIndexes(hunks[hunkIndex]))
      if (current.has(lineIndex)) current.delete(lineIndex)
      else current.add(lineIndex)
      next.set(hunkIndex, current)
      setSelected((selectedHunks) => {
        const updated = new Set(selectedHunks)
        if (current.size > 0) updated.add(hunkIndex)
        else updated.delete(hunkIndex)
        return updated
      })
      return next
    })
  }

  const apply = async (indices: number[]) => {
    if (indices.length === 0) return
    setBusy(true)
    setError('')
    try {
      const chosen = indices.flatMap((i) => {
        const lineSelection = selectedLines.get(i)
        if (!lineSelection) return [hunks[i]]
        const partial = selectHunkLines(hunks[i], lineSelection)
        return partial ? [partial] : []
      })
      const patch = buildPatch(fileHeader, chosen)
      await GitSync.ApplyHunk(repoPath, patch, staged)
      onDone()
      // Reload: remaining hunks shift, so re-read the file's diff.
      await load()
      if (hunks.length === indices.length) onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const actionLabel = staged ? 'Unstage' : 'Stage'
  const selectedIdx = [...selected].sort((a, b) => a - b)

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className="flex max-h-[82vh] w-[680px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
          <Scissors size={14} className="text-accent" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-1" title={path}>{actionLabel} hunks — {path}</div>
            <div className="font-mono text-[10px] text-text-4">{staged ? 'staged (index → worktree)' : 'unstaged (worktree → index)'}</div>
          </div>
        </div>

        {error && <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-4"><Loader2 size={14} className="animate-spin" /> Loading diff…</div>
          ) : hunks.length === 0 ? (
            <div className="rounded border border-border-1 bg-surface-0 p-6 text-center text-xs text-text-4">
              No text hunks to {actionLabel.toLowerCase()} (binary, untracked, or pure add/delete). Use the whole-file {actionLabel.toLowerCase()} button instead.
            </div>
          ) : (
            <div className="space-y-2">
              {hunks.map((hunk, i) => (
                <div key={i} className={cn('rounded border bg-surface-0', selected.has(i) ? 'border-accent/50' : 'border-border-1')}>
                  <label className="flex cursor-pointer items-center gap-2 border-b border-border-1 px-2 py-1.5">
                    <input type="checkbox" checked={selectedLines.has(i) ? selectedLines.get(i)?.size === changedLineIndexes(hunk).length : selected.has(i)} onChange={() => toggle(i)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                    <code className="truncate font-mono text-[10px] text-accent">{hunk.header}</code>
                    <button
                      onClick={(e) => { e.preventDefault(); void apply([i]) }}
                      disabled={busy}
                      className="ml-auto rounded border border-border-2 px-2 py-0.5 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40"
                    >
                      {actionLabel} this
                    </button>
                  </label>
                  <pre className="max-h-48 overflow-auto px-2 py-1.5 font-mono text-[10px] leading-[1.35]">
                    {hunk.lines.map((line, j) => (
                      <div key={j} className={`${lineClass(line)} flex min-w-max items-start`}>
                        {(line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---') ? (
                          <input
                            type="checkbox"
                            checked={selectedLines.get(i)?.has(j) ?? selected.has(i)}
                            onChange={() => toggleLine(i, j)}
                            className="mr-1.5 mt-0.5 h-3 w-3 shrink-0 accent-[var(--color-accent)]"
                            title={`${actionLabel} this line`}
                          />
                        ) : <span className="mr-1.5 inline-block w-3" />}
                        <span>{line || ' '}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button onClick={onClose} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1">Close</button>
          <button
            disabled={busy || selected.size === 0 || hunks.length === 0}
            onClick={() => void apply(selectedIdx)}
            className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40"
          >
            {busy && <Loader2 size={12} className="animate-spin" />} {actionLabel} selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  )
}
