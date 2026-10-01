import { useEffect, useRef, useState } from 'react'
import { AlertCircle, FileCode2, Loader2, PenLine } from 'lucide-react'
import { requestPrepareRename, requestRename, type GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { changedLines } from './goStudioChangePreview'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
import { GoStudioFileIcon } from './GoStudioFileIcon'

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
  const inputRef = useRef<HTMLInputElement>(null)
  const close = () => useGoIDELspStore.setState({ renameRequest: null })

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
    <GoStudioModal
      open
      onClose={close}
      top
      size="sm"
      icon={PenLine}
      title={<>Rename {original ? <code className="gs-mono text-[14px] text-accent">{original}</code> : 'symbol'}</>}
      ariaLabel="Rename symbol"
      subtitle="Semantic rename across packages. Changes stay unsaved until you save."
      footer={<>
        <GoStudioButton variant="ghost" onClick={close}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-rename-form" loading={busy} disabled={!valid}>Rename</GoStudioButton>
      </>}
    >
      <form id="go-studio-rename-form" className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <input ref={inputRef} value={name} readOnly={busy && !original} onChange={(event) => setName(event.target.value)} aria-label="New name" className="gs-input gs-mono" />
        {error ? <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert> : name && !GO_IDENTIFIER.test(name) ? <p className="gs-hint text-warning">Not a valid Go identifier.</p> : null}
      </form>
    </GoStudioModal>
  )
}

/** Anteprima di una modifica su più file: nulla viene applicato finché l'utente non conferma. */
export function GoStudioChangePreviewDialog() {
  const change = useGoIDELspStore((state) => state.pendingChange)
  const [selected, setSelected] = useState(0)
  const [applying, setApplying] = useState(false)
  const applyRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    const onCancel = useGoIDELspStore.getState().pendingChangeOnCancel
    useGoIDELspStore.setState({ pendingChange: null, pendingChangeOnCancel: null })
    onCancel?.()
  }
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
    <GoStudioModal
      open
      onClose={close}
      size="xl"
      tall
      divided
      flush
      icon={FileCode2}
      title={change.label || 'Refactoring preview'}
      subtitle={`${totalEdits} change${totalEdits === 1 ? '' : 's'} in ${change.files.length} file${change.files.length === 1 ? '' : 's'}`}
      footerStart={change.files.some((item) => item.created) ? 'New files are created on disk; the others are updated in the editor, unsaved.' : 'Files are updated in the editor as unsaved changes: review, then Save All.'}
      footer={<>
        <GoStudioButton variant="ghost" onClick={close}>Cancel</GoStudioButton>
        <button ref={applyRef} type="button" disabled={applying} onClick={() => void apply(change)} className="gs-btn gs-btn-primary">{applying && <Loader2 size={14} className="animate-spin" />} Apply changes</button>
      </>}
    >
      <div className="flex min-h-0 flex-1">
        <div role="listbox" aria-label="Changed files" className="w-72 shrink-0 overflow-auto border-r border-border-1 p-1.5">
          {change.files.map((item, index) => (
            <button key={item.uri} type="button" role="option" aria-selected={index === selected} onClick={() => setSelected(index)} className={`flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2/60'}`}>
              <GoStudioFileIcon name={item.relativePath.split('/').pop() ?? item.relativePath} relativePath={item.relativePath} />
              <span className="min-w-0 flex-1 truncate">{item.relativePath}</span>
              {item.created && <span className="gs-badge h-[18px] text-[10.5px] text-success">new</span>}
              <span className="gs-badge h-[18px] text-[10.5px]">{item.edits.length}</span>
            </button>
          ))}
        </div>
        <div className="gs-mono min-w-0 flex-1 overflow-auto bg-surface-0 p-3 text-[11.5px] leading-5">
          {file && changedLines(file).map(({ line, text, hunkStart, kind }, index) => (
            <div key={`${kind}-${line}-${index}`} className={`flex gap-3 rounded-sm border-l-2 px-1.5 ${kind === 'removed' ? 'border-danger/60 bg-danger/5' : 'border-success/60 bg-success/5'} ${hunkStart ? 'mt-2' : ''}`}>
              <span className="w-10 shrink-0 select-none text-right text-text-4">{line}</span>
              <span className={`w-2 shrink-0 select-none ${kind === 'removed' ? 'text-danger' : 'text-success'}`}>{kind === 'removed' ? '−' : '+'}</span>
              <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${kind === 'removed' ? 'text-text-3 line-through decoration-danger/40' : 'text-text-1'}`}>{text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </GoStudioModal>
  )
}
