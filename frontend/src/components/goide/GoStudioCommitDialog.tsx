import { useEffect, useRef, useState } from 'react'
import { AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
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

/** Commit (Ctrl+K): si registrano solo i file spuntati; i file non versionati partono esclusi, come in GoLand. */
export function GoStudioCommitDialog({ sessionId, open, onClose, onResolveConflicts }: GoStudioCommitDialogProps) {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const changes = status?.changes ?? []

  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    void useGoIDEVCSStore.getState().refreshStatus(sessionId)
    const timer = window.setTimeout(() => messageRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
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

  const commit = async () => {
    if (busy || !message.trim() || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      // Si registra il contenuto salvato: prima si salvano gli editor modificati.
      if (!await useGoIDEStore.getState().saveAllDocuments(sessionId)) return setBusy(false)
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
      <form id="go-studio-commit-form" className="flex flex-col gap-3 p-5" onSubmit={(event) => { event.preventDefault(); void commit() }}>
        <textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit() } }}
          rows={3} placeholder="Commit message" aria-label="Commit message" className="gs-input" />
        {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      </form>
    </GoStudioModal>
  )
}
