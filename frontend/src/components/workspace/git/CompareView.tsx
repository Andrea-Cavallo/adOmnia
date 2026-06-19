import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, ClipboardCopy, Download, Eye, Loader2, Search, X } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { compareCommits, createPatch, fileAtCommit } from '@/lib/git/gitService'
import type { ChangedFile, CompareResult } from '@/lib/git/types'
import { DiffModal } from '@/components/response/DiffView'
import { cn } from '@/lib/utils'

interface CompareViewProps {
  repoPath: string
  refA: string
  /** Empty string compares refA against the working tree. */
  refB: string
  title: string
  onClose: () => void
}

function badgeClass(status: string): string {
  if (status === 'A') return 'bg-success/15 text-success'
  if (status === 'D') return 'bg-error/15 text-error'
  if (status === 'R' || status === 'C') return 'bg-accent/15 text-accent'
  if (status === 'U') return 'bg-warning/15 text-warning'
  return 'bg-surface-3 text-text-3'
}

function statusLabel(status: string): string {
  return { A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict' }[status] ?? 'Modified'
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Dedicated comparison view: file list with per-file status, total additions /
 * deletions, name/extension filtering, copy/save patch, and a reused DiffModal
 * (unified + side-by-side, search, collapse) for each file.
 */
export function CompareView({ repoPath, refA, refB, title, onClose }: CompareViewProps) {
  const isWorkingTree = refB === ''
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [openFile, setOpenFile] = useState<{ file: ChangedFile; left: string; right: string } | null>(null)
  const [openingPath, setOpeningPath] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    compareCommits(repoPath, refA, refB)
      .then((r) => { if (!cancelled) setResult(r) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [repoPath, refA, refB])

  const files = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const all = result?.files ?? []
    if (!needle) return all
    return all.filter((f) => f.path.toLowerCase().includes(needle))
  }, [result, filter])

  const openDiff = async (file: ChangedFile) => {
    setOpeningPath(file.path)
    setError('')
    try {
      let left = ''
      let right = ''
      if (isWorkingTree) {
        const raw = await GitSync.GetWorkingTreeFileSnapshot(repoPath, file.path, file.oldPath ?? '')
        const snap = JSON.parse(raw) as { newContent: string }
        // Left = the selected ref's version (works for any refA, not just HEAD);
        // right = the live working-tree content.
        left = file.status === 'A' ? '' : await fileAtCommit(repoPath, refA, file.oldPath || file.path).catch(() => '')
        right = snap.newContent
      } else {
        left = file.status === 'A' ? '' : await fileAtCommit(repoPath, refA, file.oldPath || file.path)
        right = file.status === 'D' ? '' : await fileAtCommit(repoPath, refB, file.path)
      }
      setOpenFile({ file, left, right })
    } catch (e) {
      setError(String(e))
    } finally {
      setOpeningPath('')
    }
  }

  const copyPatch = async () => {
    try {
      const patch = await createPatch(repoPath, refA, refB)
      await navigator.clipboard.writeText(patch)
    } catch (e) {
      setError(String(e))
    }
  }

  const savePatch = async () => {
    try {
      const patch = await createPatch(repoPath, refA, refB)
      download(patch, `compare-${refA.replace(/[^\w.-]/g, '_')}.patch`)
    } catch (e) {
      setError(String(e))
    }
  }

  const rightLabel = isWorkingTree ? 'Working tree' : refB

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-1 px-4">
          <ArrowLeftRight size={15} className="text-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-text-1">{title}</div>
            <div className="truncate font-mono text-[10px] text-text-4">{refA} → {rightLabel}</div>
          </div>
          {result && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-success">+{result.additions}</span>
              <span className="text-error">−{result.deletions}</span>
              <span className="text-text-4">{result.files.length} files</span>
            </div>
          )}
          <button onClick={copyPatch} title="Copy patch to clipboard" className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-text-1"><ClipboardCopy size={14} /></button>
          <button onClick={savePatch} title="Save patch" className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-text-1"><Download size={14} /></button>
          <button onClick={onClose} title="Close" className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-text-1"><X size={15} /></button>
        </div>

        {/* Filter */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border-1 px-4 py-2">
          <Search size={13} className="text-text-4" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by file name or extension…"
            className="h-7 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent"
          />
        </div>

        {/* File list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-4"><Loader2 size={14} className="animate-spin" /> Comparing…</div>}
          {error && <div className="mb-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}
          {!loading && files.length === 0 && !error && <div className="py-10 text-center text-xs text-text-4">No differences.</div>}
          <div className="space-y-1">
            {files.map((file) => (
              <button
                key={`${file.status}-${file.path}`}
                onClick={() => void openDiff(file)}
                className="flex w-full items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left hover:border-accent/40 hover:bg-surface-2"
              >
                <span className={cn('w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px]', badgeClass(file.status))}>{statusLabel(file.status)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-2" title={file.path}>{file.path}</span>
                {file.oldPath && <span className="max-w-[160px] truncate text-[10px] text-text-4">from {file.oldPath}</span>}
                {openingPath === file.path ? <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> : <Eye size={12} className="shrink-0 text-text-4" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {openFile && (
        <DiffModal
          title={`Diff — ${openFile.file.path}`}
          leftLabel={`${refA} — ${openFile.file.oldPath || openFile.file.path}`}
          rightLabel={`${rightLabel} — ${openFile.file.path}`}
          leftBody={openFile.left}
          rightBody={openFile.right}
          defaultDiffOnly
          onClose={() => setOpenFile(null)}
        />
      )}
    </div>
  )
}
