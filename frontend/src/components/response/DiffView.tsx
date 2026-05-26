/**
 * DiffView.tsx — P2-07 Live Response Diff / Compare Mode
 *
 * Exports:
 *  - computeLineDiff(a, b)       → DiffEntry[]   (proper LCS algorithm)
 *  - DiffModal                   → side-by-side diff with summary + nav
 *  - DiffPickerModal             → tab picker + paste textarea
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, ChevronUp, ChevronDown, EyeOff, Eye, GitCompare } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'

// ─── Diff algorithm ───────────────────────────────────────────────────────────

export type DiffEntry =
  | { kind: 'context'; text: string; leftIdx: number; rightIdx: number }
  | { kind: 'removed'; text: string; leftIdx: number }
  | { kind: 'added'; text: string; rightIdx: number }

/**
 * LCS-based line diff. Falls back to naive all-removed / all-added for inputs
 * that would exceed ~4M DP cells (keeps the UI snappy for huge responses).
 */
export function computeLineDiff(a: string[], b: string[]): DiffEntry[] {
  const n = a.length
  const m = b.length

  if (n * m > 4_000_000) {
    return [
      ...a.map((text, i) => ({ kind: 'removed' as const, text, leftIdx: i + 1 })),
      ...b.map((text, j) => ({ kind: 'added' as const, text, rightIdx: j + 1 })),
    ]
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack to build diff entries
  const entries: DiffEntry[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      entries.unshift({ kind: 'context', text: a[i - 1], leftIdx: i, rightIdx: j })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      entries.unshift({ kind: 'added', text: b[j - 1], rightIdx: j })
      j--
    } else {
      entries.unshift({ kind: 'removed', text: a[i - 1], leftIdx: i })
      i--
    }
  }
  return entries
}

/** Collapse runs of context lines to ±CONTEXT_LINES around diff hunks. */
const CONTEXT_LINES = 3

export function collapseDiff(entries: DiffEntry[]): Array<DiffEntry | { kind: 'ellipsis'; count: number }> {
  // Mark which indices are "near a diff"
  const isDiff = entries.map((e) => e.kind !== 'context')
  const keep = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    if (isDiff[i]) {
      for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(entries.length - 1, i + CONTEXT_LINES); k++) {
        keep.add(k)
      }
    }
  }

  const result: Array<DiffEntry | { kind: 'ellipsis'; count: number }> = []
  let skipped = 0
  for (let i = 0; i < entries.length; i++) {
    if (keep.has(i)) {
      if (skipped > 0) {
        result.push({ kind: 'ellipsis', count: skipped })
        skipped = 0
      }
      result.push(entries[i])
    } else {
      skipped++
    }
  }
  if (skipped > 0) result.push({ kind: 'ellipsis', count: skipped })
  return result
}

// ─── DiffModal ────────────────────────────────────────────────────────────────

interface DiffModalProps {
  leftLabel: string
  rightLabel: string
  leftBody: string
  rightBody: string
  onClose: () => void
}

export function DiffModal({ leftLabel, rightLabel, leftBody, rightBody, onClose }: DiffModalProps) {
  const [diffOnly, setDiffOnly] = useState(true)
  const [diffPos, setDiffPos] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Pretty-print JSON if possible
  const prettify = (s: string) => {
    try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
  }
  const leftPretty = useMemo(() => prettify(leftBody), [leftBody])
  const rightPretty = useMemo(() => prettify(rightBody), [rightBody])

  const allEntries = useMemo(
    () => computeLineDiff(leftPretty.split('\n'), rightPretty.split('\n')),
    [leftPretty, rightPretty],
  )

  const displayEntries = useMemo(
    () => (diffOnly ? collapseDiff(allEntries) : allEntries),
    [allEntries, diffOnly],
  )

  const addedCount = useMemo(() => allEntries.filter((e) => e.kind === 'added').length, [allEntries])
  const removedCount = useMemo(() => allEntries.filter((e) => e.kind === 'removed').length, [allEntries])
  const unchangedCount = useMemo(() => allEntries.filter((e) => e.kind === 'context').length, [allEntries])

  // Indices in displayEntries that are diff (not context / ellipsis)
  const diffPositions = useMemo(
    () => displayEntries.reduce<number[]>((acc, e, i) => {
      if (e.kind !== 'context' && e.kind !== 'ellipsis') acc.push(i)
      return acc
    }, []),
    [displayEntries],
  )

  const scrollToDiff = useCallback((pos: number) => {
    if (!containerRef.current || diffPositions.length === 0) return
    const safePos = ((pos % diffPositions.length) + diffPositions.length) % diffPositions.length
    setDiffPos(safePos)
    const rows = containerRef.current.querySelectorAll<HTMLElement>('[data-diff-row]')
    rows[diffPositions[safePos]]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [diffPositions])

  // Keyboard: Escape to close, n/p for next/prev diff
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) scrollToDiff(diffPos + 1)
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) scrollToDiff(diffPos - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, scrollToDiff, diffPos])

  const identical = addedCount === 0 && removedCount === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[min(96vw,1100px)] h-[min(90vh,760px)] bg-surface-0 border border-border-1 rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1 flex-shrink-0">
          <GitCompare size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text-1 flex-1">Response Compare</span>

          {/* Summary badges */}
          {identical ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-success/20 text-success">Identical</span>
          ) : (
            <>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-error/15 text-error">−{removedCount}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-success/15 text-success">+{addedCount}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-3 text-text-3">~{unchangedCount}</span>
            </>
          )}

          <span className="w-px h-4 bg-border-2 mx-1" />

          {/* Diff-only toggle */}
          <button
            onClick={() => setDiffOnly((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors',
              diffOnly ? 'bg-accent/20 text-accent' : 'text-text-4 hover:text-text-1 hover:bg-surface-2',
            )}
            title={diffOnly ? 'Show full file' : 'Show only differences'}
          >
            {diffOnly ? <EyeOff size={11} /> : <Eye size={11} />}
            {diffOnly ? 'Diff only' : 'Full file'}
          </button>

          {/* Prev / next diff */}
          {!identical && (
            <>
              <button
                onClick={() => scrollToDiff(diffPos - 1)}
                disabled={diffPositions.length === 0}
                className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 disabled:opacity-30"
                title="Prev diff (p)"
              >
                <ChevronUp size={13} />
              </button>
              <button
                onClick={() => scrollToDiff(diffPos + 1)}
                disabled={diffPositions.length === 0}
                className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 disabled:opacity-30"
                title="Next diff (n)"
              >
                <ChevronDown size={13} />
              </button>
            </>
          )}

          <button onClick={onClose} className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 ml-1">
            <X size={14} />
          </button>
        </div>

        {/* Column labels */}
        <div className="grid grid-cols-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-3 truncate border-r border-border-1">
            ← {leftLabel}
          </div>
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-3 truncate">
            {rightLabel} →
          </div>
        </div>

        {/* Diff body */}
        <div ref={containerRef} className="flex-1 overflow-auto font-mono text-[11px] leading-5">
          {identical ? (
            <div className="flex items-center justify-center h-full text-text-3 text-xs gap-2">
              <span className="text-success text-lg">✓</span> Responses are identical
            </div>
          ) : (
            displayEntries.map((entry, idx) => {
              if (entry.kind === 'ellipsis') {
                return (
                  <div key={idx} className="grid grid-cols-2 bg-surface-1 border-y border-border-1/40">
                    <div className="px-3 py-0.5 text-[9px] text-text-4 col-span-2">
                      … {entry.count} unchanged line{entry.count !== 1 ? 's' : ''} …
                    </div>
                  </div>
                )
              }

              const isRemoved = entry.kind === 'removed'
              const isAdded = entry.kind === 'added'

              const leftNum = entry.kind === 'context' ? entry.leftIdx : (isRemoved ? entry.leftIdx : null)
              const rightNum = entry.kind === 'context' ? entry.rightIdx : (isAdded ? entry.rightIdx : null)
              const leftText = entry.kind !== 'added' ? entry.text : ''
              const rightText = entry.kind !== 'removed' ? entry.text : ''

              return (
                <div
                  key={idx}
                  data-diff-row
                  className="grid grid-cols-2"
                >
                  {/* Left cell */}
                  <div className={cn(
                    'flex items-start border-r border-border-1/40',
                    isRemoved ? 'bg-error/10' : 'bg-transparent',
                  )}>
                    <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-text-4 select-none border-r border-border-1/30 text-[9px]">
                      {leftNum ?? ''}
                    </span>
                    <span className={cn(
                      'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                      isRemoved ? 'text-error' : 'text-text-2',
                    )}>
                      {isRemoved && <span className="mr-1 text-error/60 select-none">−</span>}
                      {leftText}
                    </span>
                  </div>

                  {/* Right cell */}
                  <div className={cn(
                    'flex items-start',
                    isAdded ? 'bg-success/10' : 'bg-transparent',
                  )}>
                    <span className="w-10 shrink-0 text-right pr-2 py-0.5 text-text-4 select-none border-r border-border-1/30 text-[9px]">
                      {rightNum ?? ''}
                    </span>
                    <span className={cn(
                      'flex-1 px-2 py-0.5 whitespace-pre-wrap break-all',
                      isAdded ? 'text-success' : 'text-text-2',
                    )}>
                      {isAdded && <span className="mr-1 text-success/60 select-none">+</span>}
                      {rightText}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer hint */}
        {!identical && (
          <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border-1 bg-surface-1 text-[9px] text-text-4 flex-shrink-0">
            <span>Press <kbd className="px-1 bg-surface-3 rounded">n</kbd> next diff</span>
            <span>Press <kbd className="px-1 bg-surface-3 rounded">p</kbd> prev diff</span>
            <span>Press <kbd className="px-1 bg-surface-3 rounded">Esc</kbd> to close</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── DiffPickerModal ──────────────────────────────────────────────────────────

interface DiffPickerModalProps {
  /** The body of the response we're comparing FROM */
  currentTabId: string | null
  onConfirm: (body: string, label: string) => void
  onCancel: () => void
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
}

export function DiffPickerModal({ currentTabId, onConfirm, onCancel }: DiffPickerModalProps) {
  const tabs = useTabsStore((s) => s.tabs)
  const [pasteText, setPasteText] = useState('')
  const [mode, setMode] = useState<'tabs' | 'paste'>('tabs')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const candidateTabs = tabs.filter(
    (t) => t.id !== currentTabId && t.response && !t.response.error,
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  useEffect(() => {
    if (mode === 'paste') setTimeout(() => textareaRef.current?.focus(), 30)
  }, [mode])

  const submitPaste = () => {
    if (!pasteText.trim()) return
    onConfirm(pasteText.trim(), 'Pasted text')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="w-[min(90vw,560px)] bg-surface-1 border border-border-1 rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
          <GitCompare size={14} className="text-accent" />
          <span className="text-sm font-semibold text-text-1 flex-1">Compare Response With…</span>
          <button onClick={onCancel} className="p-1 rounded text-text-4 hover:text-text-1"><X size={14} /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex border-b border-border-1">
          <button
            onClick={() => setMode('tabs')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors',
              mode === 'tabs'
                ? 'text-text-1 border-b-2 border-accent'
                : 'text-text-3 hover:text-text-2',
            )}
          >
            Open Tabs ({candidateTabs.length})
          </button>
          <button
            onClick={() => setMode('paste')}
            className={cn(
              'flex-1 py-2 text-xs font-medium transition-colors',
              mode === 'paste'
                ? 'text-text-1 border-b-2 border-accent'
                : 'text-text-3 hover:text-text-2',
            )}
          >
            Paste Text
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {mode === 'tabs' && (
            candidateTabs.length === 0 ? (
              <div className="text-center py-6 text-text-3 text-xs">
                <p className="mb-1">No other tabs with responses found.</p>
                <p className="text-text-4">Send requests in other tabs, then come back to compare.</p>
                <button
                  onClick={() => setMode('paste')}
                  className="mt-3 text-accent hover:text-accent/80 underline text-xs"
                >
                  Paste a response body instead →
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-64 overflow-auto">
                {candidateTabs.map((tab) => {
                  const resp = tab.response!
                  const statusOk = resp.status >= 200 && resp.status < 300
                  return (
                    <button
                      key={tab.id}
                      onClick={() => onConfirm(
                        resp.body,
                        `${tab.request.method} ${tab.request.name || tab.request.url || 'Untitled'} (${resp.status})`,
                      )}
                      className="flex items-center gap-2.5 px-3 py-2 bg-surface-2 hover:bg-surface-3 rounded border border-border-1 hover:border-border-2 transition-colors text-left group"
                    >
                      <span className={cn('text-[9px] font-bold shrink-0 w-14', METHOD_COLORS[tab.request.method] ?? 'text-text-3')}>
                        {tab.request.method}
                      </span>
                      <span className="flex-1 text-xs text-text-1 truncate">
                        {tab.request.name || tab.request.url || 'Untitled'}
                      </span>
                      <span className={cn(
                        'shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono',
                        statusOk ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
                      )}>
                        {resp.status}
                      </span>
                      <span className="shrink-0 text-[10px] text-text-4">{resp.ms}ms</span>
                      <span className="shrink-0 text-[10px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                        Compare →
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {mode === 'paste' && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-text-4">Paste any response body (JSON, text, XML…)</p>
              <textarea
                ref={textareaRef}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={`{\n  "example": "paste your response here"\n}`}
                rows={8}
                className="w-full px-3 py-2 bg-surface-2 border border-border-2 rounded text-xs font-mono text-text-1 outline-none focus:border-accent resize-none"
                spellCheck={false}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancel}
                  className="px-3 py-1.5 rounded text-xs text-text-3 hover:text-text-1 border border-border-2 hover:border-border-1"
                >
                  Cancel
                </button>
                <button
                  onClick={submitPaste}
                  disabled={!pasteText.trim()}
                  className="px-4 py-1.5 rounded text-xs bg-accent text-white font-medium disabled:opacity-40 flex items-center gap-1.5"
                >
                  <GitCompare size={11} /> Compare
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
