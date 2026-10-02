import { useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, FlaskConical, GitCommitHorizontal } from 'lucide-react'
import { getGoIDEChangedSymbols, type GoIDEVCSChangedSymbol } from '@/lib/goide-vcs-api'
import { runGoStudioChangedTests } from './goStudioQuickActions'
import { useGoIDEStore } from '@/stores/goide'
import { mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { precommitProblems, type GoStudioPrecommitSummary } from './goStudioPrecommit'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
import { GoStudioFileIcon } from './GoStudioFileIcon'

interface GoStudioCommitDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
  onResolveConflicts?: () => void
}

const STATUS_LABEL: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'untracked', U: 'conflict' }

function describe(status: string): string {
  const code = status.trim().charAt(0) || status.trim().charAt(1)
  return STATUS_LABEL[code] ?? status.trim()
}

const PRECOMMIT_KEY = 'adomnia.goStudio.precommitChecks'

function loadPrecommitPreference(): boolean {
  try { return localStorage.getItem(PRECOMMIT_KEY) !== 'off' } catch { return true }
}

function savePrecommitPreference(enabled: boolean): void {
  try { localStorage.setItem(PRECOMMIT_KEY, enabled ? 'on' : 'off') } catch { /* preferenza solo locale */ }
}

/** Errori gopls e risultati del linter sui file modificati, limitati ai file spuntati. */
async function runPrecommitChecks(sessionId: string, selected: Set<string>): Promise<GoStudioPrecommitSummary> {
  const lsp = useGoIDELspStore.getState()
  if (lsp.linter[sessionId]?.available) await lsp.runLint(sessionId, true)
  const state = useGoIDELspStore.getState()
  return precommitProblems(Object.values(mergedReports(state.diagnostics[sessionId], state.lint[sessionId]?.reports)), selected)
}

const TOUCH_LABEL: Record<string, string> = { http: 'HTTP API', grpc: 'gRPC', db: 'database', broker: 'broker' }

const CHANGE_MARK: Record<string, { mark: string; className: string }> = {
  added: { mark: '+', className: 'text-success' },
  modified: { mark: '~', className: 'text-accent' },
  removed: { mark: '−', className: 'text-danger' },
}

/** Dichiarazioni Go toccate dai file spuntati: cosa cambia davvero, prima di scrivere il messaggio. */
function ChangedSymbols({ symbols, selected, onClose }: { symbols: GoIDEVCSChangedSymbol[]; selected: Set<string>; onClose: () => void }) {
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const visible = symbols.filter((symbol) => selected.has(symbol.relativePath))
  if (visible.length === 0) return null
  const tests = visible.filter((symbol) => symbol.test).length
  const api = visible.filter((symbol) => symbol.exported && !symbol.test).length
  const breaking = visible.filter((symbol) => symbol.breaking).length
  const touching = (tag: string) => visible.filter((symbol) => symbol.touches?.includes(tag)).length
  const areas = (['http', 'grpc', 'db', 'broker'] as const).map((tag) => ({ tag, count: touching(tag) })).filter((item) => item.count > 0)
  return (
    <details className="border-b border-border-1 px-3 py-2 text-[12px]">
      <summary className="flex cursor-pointer items-center gap-2 text-text-2">
        <span className="font-medium">{visible.length} changed symbol{visible.length === 1 ? '' : 's'}</span>
        <span className="text-text-4">· {api} exported · {tests} test{tests === 1 ? '' : 's'}{areas.map((item) => ` · ${item.count} ${TOUCH_LABEL[item.tag]}`).join('')}</span>
        {breaking > 0 && <span className="text-danger">{breaking} breaking</span>}
        <button type="button" onClick={(event) => { event.preventDefault(); onClose(); void runGoStudioChangedTests() }} title="Run go test on the packages with changed Go files and on the packages that import them" className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-success hover:bg-success/10">
          <FlaskConical size={12} aria-hidden="true" /> Test changed packages
        </button>
      </summary>
      <div className="mt-1.5 max-h-[22vh] overflow-auto">
        {visible.map((symbol) => {
          const change = CHANGE_MARK[symbol.change] ?? CHANGE_MARK.modified
          const label = <><span className={`w-3 shrink-0 text-center font-semibold ${change.className}`} aria-label={symbol.change}>{change.mark}</span><span className="w-12 shrink-0 text-[10.5px] text-text-4">{symbol.kind}</span><span className={`truncate font-mono text-[11.5px] ${symbol.exported ? 'text-text-1' : 'text-text-2'}`}>{symbol.name}</span>{symbol.breaking && <span title={symbol.change === 'removed' ? 'Exported symbol removed: callers outside the package break' : 'Exported signature changed: callers outside the package may break'} className="gs-badge h-[16px] text-[10px] text-danger">breaking</span>}{symbol.test && <span className="gs-badge h-[16px] text-[10px]">test</span>}{symbol.touches?.map((tag) => <span key={tag} title={`Touches ${TOUCH_LABEL[tag] ?? tag} (read from the source)`} className="gs-badge h-[16px] text-[10px] text-warning">{TOUCH_LABEL[tag] ?? tag}</span>)}<span className="ml-auto shrink-0 truncate font-mono text-[10.5px] text-text-4">{symbol.relativePath}{symbol.line ? `:${symbol.line}` : ''}</span></>
          return symbol.line
            ? <button key={`${symbol.relativePath}:${symbol.kind}:${symbol.name}`} type="button" onClick={() => { onClose(); void openLocation(symbol.relativePath, symbol.line, 1) }} className="flex h-6 w-full items-center gap-2 rounded px-1.5 text-left hover:bg-surface-2/60">{label}</button>
            : <div key={`${symbol.relativePath}:${symbol.kind}:${symbol.name}`} className="flex h-6 items-center gap-2 px-1.5 opacity-80" title="Removed: no longer in the file">{label}</div>
        })}
      </div>
    </details>
  )
}

/** Commit (Ctrl+K): si registrano solo i file spuntati; i file non versionati partono esclusi, come in GoLand. */
export function GoStudioCommitDialog({ sessionId, open, onClose, onResolveConflicts }: GoStudioCommitDialogProps) {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<GoIDEVCSChangedSymbol[]>([])
  const [checkFirst, setCheckFirst] = useState(loadPrecommitPreference)
  const [blocked, setBlocked] = useState<GoStudioPrecommitSummary | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const changes = status?.changes ?? []

  useEffect(() => {
    if (!open) return
    setError(null)
    setBlocked(null)
    setBusy(false)
    void useGoIDEVCSStore.getState().refreshStatus(sessionId)
    let cancelled = false
    setSymbols([])
    // Facoltativo: se il calcolo fallisce il commit resta disponibile, senza riepilogo.
    getGoIDEChangedSymbols(sessionId).then((items) => { if (!cancelled) setSymbols(items) }).catch(() => undefined)
    const timer = window.setTimeout(() => messageRef.current?.focus(), 30)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, sessionId])
  useEffect(() => {
    if (open) setSelected(new Set(changes.filter((change) => !change.untracked && !change.conflicted).map((change) => change.relativePath)))
    // Si ricalcola solo quando cambia l'elenco dei file, non a ogni spunta.
  }, [open, changes.map((change) => change.relativePath).join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const toggle = (path: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  const commit = async (force = false) => {
    if (busy || !message.trim() || selected.size === 0) return
    setBusy(true)
    setError(null)
    setBlocked(null)
    try {
      // Si registra il contenuto salvato: prima si salvano gli editor modificati.
      if (!await useGoIDEStore.getState().saveAllDocuments(sessionId)) return setBusy(false)
      if (checkFirst && !force) {
        const problems = await runPrecommitChecks(sessionId, selected)
        if (problems.errors + problems.warnings > 0) {
          setBlocked(problems)
          return setBusy(false)
        }
      }
      const hash = await useGoIDEVCSStore.getState().commit(sessionId, message.trim(), [...selected])
      useGoIDELspStore.setState({ message: `Committed ${selected.size} file(s) as ${hash ?? 'a new commit'}.` })
      setMessage('')
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  const canCommit = !busy && !!message.trim() && selected.size > 0
  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      divided
      flush
      icon={GitCommitHorizontal}
      title={<>Commit to <span className="gs-mono text-[14px]">{status?.branch ?? 'branch'}</span></>}
      ariaLabel="Commit changes"
      subtitle="Local only: nothing is pushed."
      footerStart={<>{selected.size} of {changes.length} file{changes.length === 1 ? '' : 's'} · <span className="gs-kbd">Ctrl</span><span className="gs-kbd">Enter</span> commits</>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-commit-form" loading={busy} disabled={!canCommit}>Commit</GoStudioButton>
      </>}
    >
      <div className="max-h-[36vh] overflow-auto border-b border-border-1 p-1.5">
        {changes.length === 0 && <p className="gs-list-empty">No local changes in this project.</p>}
        {changes.map((change) => (
          <label key={change.relativePath} className={`flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 hover:bg-surface-2/60 ${change.conflicted ? 'opacity-60' : ''}`}>
            <input type="checkbox" checked={selected.has(change.relativePath)} disabled={change.conflicted} onChange={() => toggle(change.relativePath)} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />
            <GoStudioFileIcon name={change.relativePath.split('/').pop() ?? change.relativePath} relativePath={change.relativePath} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-1">{change.relativePath}</span>
            {change.conflicted && onResolveConflicts
              ? <button type="button" onClick={(event) => { event.preventDefault(); onResolveConflicts() }} className="gs-badge h-[18px] text-[10.5px] text-danger underline-offset-2 hover:underline">conflict · resolve…</button>
              : <span className={`gs-badge h-[18px] text-[10.5px] ${change.untracked ? '' : change.conflicted ? 'text-danger' : 'text-accent'}`}>{change.conflicted ? 'conflict · resolve in Git Studio' : describe(change.status)}</span>}
          </label>
        ))}
      </div>
      <ChangedSymbols symbols={symbols} selected={selected} onClose={onClose} />
      <form id="go-studio-commit-form" className="flex flex-col gap-3 p-5" onSubmit={(event) => { event.preventDefault(); void commit() }}>
        <textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit() } }}
          rows={3} placeholder="Commit message" aria-label="Commit message" className="gs-input" />
        <label className="flex items-center gap-2 text-[12px] text-text-3">
          <input type="checkbox" checked={checkFirst} onChange={(event) => { setCheckFirst(event.target.checked); savePrecommitPreference(event.target.checked) }} className="h-[14px] w-[14px] accent-[var(--color-accent)]" />
          Check for errors and lint warnings in these files before committing
        </label>
        {blocked && (
          <GoStudioAlert tone="warning" icon={AlertTriangle}>
            <div className="flex flex-wrap items-center gap-2">
              <span>{blocked.errors} error{blocked.errors === 1 ? '' : 's'} and {blocked.warnings} warning{blocked.warnings === 1 ? '' : 's'} in {blocked.files.length} file{blocked.files.length === 1 ? '' : 's'} you are committing.</span>
              <span className="ml-auto flex gap-1.5">
                <GoStudioButton small variant="ghost" onClick={() => { useGoIDELspStore.getState().showToolWindow('problems'); onClose() }}>Show Problems</GoStudioButton>
                <GoStudioButton small variant="secondary" onClick={() => void commit(true)}>Commit anyway</GoStudioButton>
              </span>
            </div>
          </GoStudioAlert>
        )}
        {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      </form>
    </GoStudioModal>
  )
}
