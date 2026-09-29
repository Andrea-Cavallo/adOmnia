import { useEffect, useRef, useState } from 'react'
import { FolderOpen, GitBranch, Loader2, X } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import { chooseGoIDEProjectFolder } from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore } from '@/stores/goide'

interface GoStudioCloneDialogProps {
  open: boolean
  onClose: () => void
}

const URL_HINT = /^(?:(?:https?|ssh|git):\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/

/** File → Clone Repository…: git clone in una cartella scelta, poi il progetto si apre (non autorizzato). */
export function GoStudioCloneDialog({ open, onClose }: GoStudioCloneDialogProps) {
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, () => { if (!busy) onClose() }, dialogRef)
  useEffect(() => { if (open) setError(null) }, [open])
  if (!open) return null

  const name = url.trim().replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop() ?? ''
  const valid = URL_HINT.test(url.trim()) && parent.trim() !== ''
  const browse = async () => {
    const folder = await chooseGoIDEProjectFolder().catch(() => '')
    if (folder) setParent(folder)
  }
  const clone = async () => {
    setBusy(true)
    setError(null)
    try {
      const destination = await GoIDEBindings.CloneRepository(url.trim(), parent.trim())
      onClose()
      await useGoIDEStore.getState().openProject(destination)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ad-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => { if (!busy) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Clone repository" tabIndex={-1} onClick={(event) => event.stopPropagation()} className="w-[min(560px,100%)] overflow-hidden rounded-2xl border border-border-2 bg-surface-1">
        <div className="flex h-11 items-center gap-2 border-b border-border-1 px-4">
          <GitBranch size={14} className="text-accent" />
          <h2 className="text-[13px] font-semibold text-text-1">Clone Repository</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={14} /></button>
        </div>
        <form className="space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); if (valid && !busy) void clone() }}>
          <label className="block text-[11px] font-medium text-text-3">Repository URL
            <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo.git or git@host:owner/repo.git" className="mt-1 h-9 w-full rounded-lg border border-border-1 bg-surface-0 px-3 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
          </label>
          <label className="block text-[11px] font-medium text-text-3">Parent folder
            <span className="mt-1 flex gap-2">
              <input value={parent} onChange={(event) => setParent(event.target.value)} placeholder="C:\Users\you\Workspaces" className="h-9 min-w-0 flex-1 rounded-lg border border-border-1 bg-surface-0 px-3 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
              <button type="button" onClick={() => void browse()} className="flex h-9 items-center gap-1.5 rounded-lg border border-border-2 px-3 text-xs text-text-2 hover:text-text-1"><FolderOpen size={13} /> Browse…</button>
            </span>
          </label>
          {valid && name && <p className="font-mono text-[11px] text-text-4">→ {parent.replace(/[\\/]+$/, '')}{parent.includes('\\') ? '\\' : '/'}{name}</p>}
          <p className="text-[11px] leading-relaxed text-text-4">Uses the Git and credentials already configured on this machine. The project opens without trust: nothing runs until you trust it.</p>
          {error && <p role="alert" className="whitespace-pre-wrap break-words rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-lg px-3.5 text-xs text-text-2 hover:bg-surface-3">Cancel</button>
            <button type="submit" disabled={!valid || busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-light disabled:opacity-40">
              {busy && <Loader2 size={12} className="animate-spin" />} {busy ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
