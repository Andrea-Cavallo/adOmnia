import { useEffect, useState } from 'react'
import { GitCommit, Loader2, X } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { fileHistory } from '@/lib/git/gitService'
import type { CommitInfo } from '@/lib/git/types'

interface BlameLine {
  hash: string
  author: string
  email: string
  date: string
  lineNumber: number
  content: string
}

export function FileInsightsDialog({ repoPath, path, mode, onClose, onOpenCommit }: {
  repoPath: string
  path: string
  mode: 'history' | 'blame'
  onClose: () => void
  onOpenCommit: (hash: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [blame, setBlame] = useState<BlameLine[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const request = mode === 'history'
      ? fileHistory(repoPath, path, 200).then((items) => { if (!cancelled) setCommits(items) })
      : GitSync.BlameLines(repoPath, path).then((raw) => { if (!cancelled) setBlame(JSON.parse(raw) as BlameLine[]) })
    request.catch((e) => { if (!cancelled) setError(String(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, path, repoPath])

  return (
    <div className="fixed inset-0 z-[165] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="flex h-[min(82vh,820px)] w-[min(92vw,1100px)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <GitCommit size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">{mode === 'history' ? 'File history' : 'Visual blame'}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-3" title={path}>{path}</span>
          <button onClick={onClose} className="rounded p-1 text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-0">
          {loading && <div className="flex items-center justify-center gap-2 py-16 text-xs text-text-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
          {error && <div className="m-4 rounded border border-error/30 bg-error/10 p-3 text-xs text-error">{error}</div>}
          {!loading && !error && mode === 'history' && (
            <div className="divide-y divide-border-1">
              {commits.map((commit) => (
                <button key={commit.fullHash || commit.hash} onClick={() => onOpenCommit(commit.fullHash || commit.hash)} className="grid w-full grid-cols-[92px_110px_minmax(0,1fr)_160px] items-center gap-3 px-4 py-2 text-left hover:bg-surface-2">
                  <span className="font-mono text-[11px] text-accent">{commit.hash}</span>
                  <span className="text-[10px] text-text-4">{commit.date}</span>
                  <span className="truncate text-xs text-text-1">{commit.message}</span>
                  <span className="truncate text-right text-[10px] text-text-3">{commit.author}</span>
                </button>
              ))}
              {commits.length === 0 && <div className="p-10 text-center text-xs text-text-4">No history for this file.</div>}
            </div>
          )}
          {!loading && !error && mode === 'blame' && (
            <div className="min-w-max font-mono text-[11px] leading-5">
              {blame.map((line) => (
                <button key={`${line.lineNumber}-${line.hash}`} onClick={() => onOpenCommit(line.hash)} className="grid w-full grid-cols-[52px_76px_110px_120px_minmax(420px,1fr)] text-left hover:bg-accent/10" title={`Open commit ${line.hash}`}>
                  <span className="border-r border-border-1 px-2 text-right text-text-4">{line.lineNumber}</span>
                  <span className="truncate border-r border-border-1 px-2 text-accent">{line.hash.slice(0, 7)}</span>
                  <span className="truncate border-r border-border-1 px-2 text-text-3">{line.author}</span>
                  <span className="border-r border-border-1 px-2 text-text-4">{line.date}</span>
                  <span className="whitespace-pre px-3 text-text-2">{line.content || ' '}</span>
                </button>
              ))}
              {blame.length === 0 && <div className="p-10 text-center text-xs text-text-4">No blame information.</div>}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-border-1 px-4 py-2 text-[10px] text-text-4">Click a row to open that commit’s file diff.</div>
      </div>
    </div>
  )
}
