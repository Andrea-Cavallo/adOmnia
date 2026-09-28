import { useEffect, useRef, useState } from 'react'
import { FileCode2, Loader2, PenLine, X } from 'lucide-react'
import { requestPrepareRename, requestRename, type GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { changedLines } from './goStudioChangePreview'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'

const GO_IDENTIFIER = /^[\p{L}_][\p{L}\p{Nd}_]*$/u

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rename semantico: valida il simbolo con gopls, poi applica subito (un file) o mostra l'anteprima (più file). */
export function GoStudioRenameDialog() {
  const request = useGoIDELspStore((state) => state.renameRequest)
  const [name, setName] = useState('')
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const close = () => useGoIDELspStore.setState({ renameRequest: null })
  useModalFocusTrap(!!request, close, dialogRef)

  useEffect(() => {
    if (!request) return
    setError(null)
    setName('')
    setBusy(true)
    const prepare = requestPrepareRename(request.sessionId, request.documentId, request.line, request.column)
    prepare.then((target) => {
      setOriginal(target.placeholder)
      setName(target.placeholder)
      window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
    }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false))
    return () => { void prepare.cancel() }
  }, [request])

  if (!request) return null
  const valid = GO_IDENTIFIER.test(name) && name !== original

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const change = await requestRename(request.sessionId, request.documentId, request.line, request.column, name)
      close()
      await applyGoStudioWorkspaceChange(change)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[16vh]" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Rename symbol" tabIndex={-1} className="w-[420px] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3"><PenLine size={12} className="text-accent" /><h2 className="text-xs font-semibold text-text-1">Rename {original ? <code className="font-mono text-accent">{original}</code> : 'symbol'}</h2><button type="button" onClick={close} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <form className="p-3" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <input ref={inputRef} value={name} readOnly={busy && !original} onChange={(event) => setName(event.target.value)} aria-label="New name" className="h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
          <p className="mt-2 text-[10px] leading-4 text-text-4">{error ? <span className="text-danger">{error}</span> : name && !GO_IDENTIFIER.test(name) ? <span className="text-warning">Not a valid Go identifier.</span> : 'Semantic rename across packages. Changes stay unsaved until you save.'}</p>
          <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={close} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="submit" disabled={!valid || busy} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />} Refactor</button></div>
        </form>
      </div>
    </div>
  )
}

/** Anteprima di una modifica su più file: nulla viene applicato finché l'utente non conferma. */
export function GoStudioChangePreviewDialog() {
  const change = useGoIDELspStore((state) => state.pendingChange)
  const [selected, setSelected] = useState(0)
  const [applying, setApplying] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const applyRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    const onCancel = useGoIDELspStore.getState().pendingChangeOnCancel
    useGoIDELspStore.setState({ pendingChange: null, pendingChangeOnCancel: null })
    onCancel?.()
  }
  useModalFocusTrap(!!change, close, dialogRef)
  useEffect(() => {
    setSelected(0)
    if (!change) return
    // Dopo il focus trap: Invio conferma subito l'anteprima.
    const timer = window.setTimeout(() => applyRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [change])
  if (!change) return null
  const file = change.files[selected]
  const totalEdits = change.files.reduce((total, item) => total + item.edits.length, 0)

  const apply = async (value: GoIDEWorkspaceChange) => {
    setApplying(true)
    useGoIDELspStore.setState({ pendingChange: null, pendingChangeOnCancel: null })
    await applyGoStudioWorkspaceChange(value, true)
    setApplying(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Preview changes" tabIndex={-1} className="flex h-[min(560px,80vh)] w-[min(860px,90vw)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">{change.label || 'Refactoring preview'}</h2><span className="text-[10px] text-text-4">{totalEdits} change{totalEdits === 1 ? '' : 's'} in {change.files.length} file{change.files.length === 1 ? '' : 's'}</span><button type="button" onClick={close} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="flex min-h-0 flex-1">
          <div role="listbox" aria-label="Changed files" className="w-64 shrink-0 overflow-auto border-r border-border-1 py-1">
            {change.files.map((item, index) => (
              <button key={item.uri} type="button" role="option" aria-selected={index === selected} onClick={() => setSelected(index)} className={`flex h-7 w-full items-center gap-1.5 px-2 text-left text-[11px] ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}>
                <FileCode2 size={11} className="shrink-0 text-accent" /><span className="min-w-0 flex-1 truncate">{item.relativePath}</span>{item.created && <span className="rounded bg-success/15 px-1 text-[9px] text-success">new</span>}<span className="text-[9px] text-text-4">{item.edits.length}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-auto bg-surface-0 p-2 font-mono text-[10px] leading-5">
            {file && changedLines(file).map(({ line, text, hunkStart, kind }, index) => (
              <div key={`${kind}-${line}-${index}`} className={`flex gap-3 border-l-2 px-1 ${kind === 'removed' ? 'border-danger/60 bg-danger/5' : 'border-success/60 bg-success/5'} ${hunkStart ? 'mt-2' : ''}`}>
                <span className="w-10 shrink-0 select-none text-right text-text-4">{line}</span>
                <span className={`w-2 shrink-0 select-none ${kind === 'removed' ? 'text-danger' : 'text-success'}`}>{kind === 'removed' ? '−' : '+'}</span>
                <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${kind === 'removed' ? 'text-text-3 line-through decoration-danger/40' : 'text-text-1'}`}>{text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3"><span className="mr-auto text-[10px] text-text-4">{change.files.some((item) => item.created) ? 'New files are created on disk; the others are updated in the editor as unsaved changes.' : 'Files are updated in the editor as unsaved changes; review, then Save All.'}</span><button type="button" onClick={close} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button ref={applyRef} type="button" disabled={applying} onClick={() => void apply(change)} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{applying && <Loader2 size={11} className="animate-spin" />} Apply changes</button></div>
      </div>
    </div>
  )
}
