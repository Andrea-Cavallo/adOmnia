import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, PenLine, RotateCcw, Trash2, X } from 'lucide-react'
import type { monaco } from '@/lib/monacoSetup'
import { requestChangeSignature } from '@/lib/goide-lsp-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { prepareDocument } from './goStudioLanguageFeatures'
import { formatSignature, parseSignatureAt, signatureOrderProblem } from './goStudioChangeSignature'

/** Ctrl+F6: legge la firma sotto il cursore e apre il dialog; spiega cosa manca altrimenti. */
export async function openChangeSignature(editor: monaco.editor.ICodeEditor): Promise<void> {
  const model = editor.getModel()
  const position = editor.getPosition()
  const prepared = model ? await prepareDocument(model) : null
  if (!model || !position || !prepared) return useGoIDELspStore.setState({ message: 'gopls is not ready for this file yet.' })
  const signature = parseSignatureAt(model.getValue(1 /* LF */), position.lineNumber)
  if (!signature) return useGoIDELspStore.setState({ message: 'Change Signature: place the caret on a function or method declaration.' })
  if (signature.params.length === 0) return useGoIDELspStore.setState({ message: `Change Signature: ${signature.name} has no parameters to reorder or remove.` })
  useGoIDELspStore.setState({ changeSignatureRequest: { sessionId: prepared.sessionId, documentId: prepared.documentId, signature } })
}

const iconButton = 'grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-30'

/**
 * Riordina o rimuove i parametri; gopls riscrive firma e tutte le chiamate, poi la modifica passa
 * dall'anteprima come ogni refactoring. Aggiungere parametri non è ancora supportato da gopls.
 */
export function GoStudioChangeSignatureDialog() {
  const request = useGoIDELspStore((state) => state.changeSignatureRequest)
  const [order, setOrder] = useState<number[]>([])
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = () => useGoIDELspStore.setState({ changeSignatureRequest: null })
  useModalFocusTrap(!!request, close, dialogRef)

  useEffect(() => {
    setOrder(request ? request.signature.params.map((_, index) => index) : [])
    setWorking(false)
    setError(null)
  }, [request])

  if (!request) return null
  const { signature } = request
  const problem = signatureOrderProblem(signature, order)
  const removed = signature.params.map((_, index) => index).filter((index) => !order.includes(index))

  const move = (position: number, delta: number) => setOrder((current) => {
    const next = [...current]
    ;[next[position], next[position + delta]] = [next[position + delta], next[position]]
    return next
  })

  const apply = async () => {
    if (problem || working) return
    setWorking(true)
    setError(null)
    try {
      const caret = { startLine: signature.line, startColumn: signature.column, endLine: signature.line, endColumn: signature.column }
      const results = Array.from({ length: signature.resultCount }, (_, index) => index)
      const change = await requestChangeSignature(request.sessionId, request.documentId, caret, order, results)
      if (change.files.length === 0) throw new Error('gopls produced no change for this signature.')
      useGoIDELspStore.setState({ changeSignatureRequest: null, pendingChange: { ...change, label: `Change Signature of ${signature.name}` } })
    } catch (reason) {
      // gopls rifiuta, per esempio, la rimozione di un parametro ancora usato nel corpo.
      setError(reason instanceof Error ? reason.message : String(reason))
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[1px]" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Change Signature" className="w-[min(640px,84vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <PenLine size={14} className="text-accent" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-text-1">Change Signature</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-text-3">{signature.name}</span>
          <button type="button" onClick={close} title="Close · Esc" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} aria-hidden="true" /></button>
        </div>
        <div className="p-3">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">Parameters</div>
          <div role="list" className="overflow-hidden rounded border border-border-1 bg-surface-0">
            {order.map((index, position) => {
              const param = signature.params[index]
              return (
                <div key={index} role="listitem" className="group flex h-8 items-center gap-2 border-b border-border-1 px-2 last:border-b-0 hover:bg-surface-2">
                  <span className="w-5 text-right font-mono text-[9px] text-text-4">{position + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    <span className="text-text-1">{param.name || '_'}</span> <span className="text-text-3">{param.type}</span>
                  </span>
                  <button type="button" disabled={position === 0} onClick={() => move(position, -1)} title="Move up" aria-label={`Move ${param.name || param.type} up`} className={iconButton}><ArrowUp size={12} /></button>
                  <button type="button" disabled={position === order.length - 1} onClick={() => move(position, 1)} title="Move down" aria-label={`Move ${param.name || param.type} down`} className={iconButton}><ArrowDown size={12} /></button>
                  <button type="button" onClick={() => setOrder((current) => current.filter((item) => item !== index))} title="Remove (gopls removes it from every call)" aria-label={`Remove ${param.name || param.type}`} className={`${iconButton} hover:text-danger`}><Trash2 size={12} /></button>
                </div>
              )
            })}
            {order.length === 0 && <p className="px-3 py-2 text-[10px] text-text-4">All parameters removed.</p>}
          </div>
          {removed.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-4">
              Removed:
              {removed.map((index) => (
                <button key={index} type="button" onClick={() => setOrder((current) => [...current, index])} title="Put back" className="inline-flex h-5 items-center gap-1 rounded border border-border-1 px-1.5 font-mono text-text-3 line-through hover:border-accent hover:no-underline"><RotateCcw size={9} />{signature.params[index].name || signature.params[index].type}</button>
              ))}
            </div>
          )}
          <div className="mb-1 mt-3 text-[9px] font-semibold uppercase tracking-wide text-text-4">Preview</div>
          <pre className="overflow-x-auto rounded border border-border-1 bg-surface-0 px-3 py-2 font-mono text-[11px] text-text-2">{formatSignature(signature, order)}</pre>
          <p className="mt-2 text-[10px] text-text-4">gopls rewrites the declaration and every call; you review the change before it is applied. Removing a parameter that the body still uses is refused. Adding parameters is not supported by gopls yet.</p>
          {error && <div role="alert" className="mt-2 rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[10px] text-danger">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-3 py-2">
          {problem && problem !== 'Nothing to change.' && <span className="mr-auto text-[10px] text-warning">{problem}</span>}
          <button type="button" onClick={close} className="h-7 rounded px-3 text-[11px] text-text-2 hover:bg-surface-3">Cancel</button>
          <button type="button" disabled={!!problem || working} onClick={() => void apply()} className="inline-flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent-light disabled:opacity-40">
            {working && <Loader2 size={12} className="animate-spin" />}Preview Changes
          </button>
        </div>
      </div>
    </div>
  )
}
