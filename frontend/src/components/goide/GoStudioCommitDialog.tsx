import { useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, Loader2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDEVCSStore } from '@/stores/goideVcs'

interface GoStudioCommitDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
}

const STATUS_LABEL: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'untracked', U: 'conflict' }

function describe(status: string): string {
  const code = status.trim().charAt(0) || status.trim().charAt(1)
  return STATUS_LABEL[code] ?? status.trim()
}

/** Commit (Ctrl+K): si registrano solo i file spuntati; i file non versionati partono esclusi, come in GoLand. */
export function GoStudioCommitDialog({ sessionId, open, onClose }: GoStudioCommitDialogProps) {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Commit changes" tabIndex={-1} className="w-[min(640px,92vw)] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-4">
          <GitCommitHorizontal size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Commit to {status?.branch ?? 'branch'}</h2>
          <span className="text-[10px] text-text-4">Local only: nothing is pushed</span>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="max-h-[36vh] overflow-auto border-b border-border-1 py-1">
          {changes.length === 0 && <p className="px-4 py-3 text-[11px] text-text-4">No local changes in this project.</p>}
          {changes.map((change) => (
            <label key={change.relativePath} className={`flex h-7 cursor-pointer items-center gap-2 px-4 text-[11px] hover:bg-surface-2 ${change.conflicted ? 'opacity-60' : ''}`}>
              <input type="checkbox" checked={selected.has(change.relativePath)} disabled={change.conflicted} onChange={() => toggle(change.relativePath)} className="h-3 w-3 accent-[var(--color-accent)]" />
              <span className="min-w-0 flex-1 truncate font-mono text-text-2">{change.relativePath}</span>
              <span className={`shrink-0 text-[9px] ${change.untracked ? 'text-text-4' : change.conflicted ? 'text-danger' : 'text-accent'}`}>{change.conflicted ? 'conflict · resolve in Git Studio' : describe(change.status)}</span>
            </label>
          ))}
        </div>
        <form className="space-y-2 p-4" onSubmit={(event) => { event.preventDefault(); void commit() }}>
          <textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void commit() } }}
            rows={3} placeholder="Commit message" aria-label="Commit message" className="w-full resize-none rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
          {error && <p role="alert" className="text-[10px] text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[10px] text-text-4">{selected.size} of {changes.length} file(s) · Ctrl+Enter commits</span>
            <button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
            <button type="submit" disabled={busy || !message.trim() || selected.size === 0} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />} Commit</button>
          </div>
        </form>
      </div>
    </div>
  )
}
