import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { baseName, duplicateName, runPathAction, type GoStudioPathAction } from './goStudioFileActions'

export interface GoStudioPathRequest {
  action: GoStudioPathAction
  /** Cartella di destinazione per new*, elemento sorgente per rename/duplicate. */
  target: string
}

const TITLES: Record<GoStudioPathAction, string> = {
  newGoFile: 'New Go File', newFile: 'New File', newFolder: 'New Folder', rename: 'Rename', duplicate: 'Duplicate',
}
const HINTS: Record<GoStudioPathAction, string> = {
  newGoFile: 'The .go extension and the package clause are added for you. Use / for subfolders.',
  newFile: 'Use / to create it inside new subfolders.',
  newFolder: 'Nested folders like internal/store are created in one step.',
  rename: 'Type a path with / to move it to another folder. Open tabs are reopened at the new path.',
  duplicate: 'Folders are copied with their contents.',
}

function initialName(request: GoStudioPathRequest): string {
  if (request.action === 'rename') return baseName(request.target)
  if (request.action === 'duplicate') return duplicateName(baseName(request.target))
  return ''
}

export function GoStudioPathDialog({ sessionId, request, onClose }: { sessionId: string; request: GoStudioPathRequest | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useModalFocusTrap(!!request, onClose, dialogRef)

  useEffect(() => {
    if (!request) return
    const value = initialName(request)
    setName(value)
    // Come JetBrains: nel rename è selezionato il nome senza estensione.
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const dot = value.lastIndexOf('.')
      input.setSelectionRange(0, dot > 0 ? dot : value.length)
    })
  }, [request])

  if (!request) return null
  const location = request.action === 'rename' || request.action === 'duplicate' ? request.target : `${request.target || '(project root)'}/`
  const submit = async () => {
    setBusy(true)
    const ok = await runPathAction(sessionId, request.action, request.target, name)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={TITLES[request.action]} tabIndex={-1} className="w-[420px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">{TITLES[request.action]}</h2><button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <form className="space-y-2 p-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="truncate font-mono text-[10px] text-text-4" title={location}>{location}</div>
          <input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" spellCheck={false} className="h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
          <p className="text-[10px] leading-4 text-text-4">{HINTS[request.action]}</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
            <button type="submit" disabled={!name.trim() || busy} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />}{request.action === 'rename' ? 'Rename' : request.action === 'duplicate' ? 'Duplicate' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
