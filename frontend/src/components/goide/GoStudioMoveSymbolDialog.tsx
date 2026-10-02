import { useEffect, useRef, useState } from 'react'
import { FolderInput, Loader2, X } from 'lucide-react'
import type { monaco } from '@/lib/monacoSetup'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import { documentForModel } from './goStudioLanguageFeatures'

interface MoveSymbolRequest {
  sessionId: string
  relativePath: string
  line: number
  column: number
  symbol: string
}

let openRequest: ((request: MoveSymbolRequest) => void) | null = null

/** Apre il dialog per la dichiarazione sotto il cursore; i file vanno salvati perché l'analisi legge il disco. */
export function openMoveSymbol(editor: monaco.editor.ICodeEditor): void {
  const model = editor.getModel()
  const position = editor.getPosition()
  const document = model ? documentForModel(model) : null
  if (!model || !position || !document || document.document.external) return void useGoIDELspStore.setState({ message: 'Move Symbol: open a Go file of the project first.' })
  const dirty = useGoIDEStore.getState().documents.some((item) => item.document.sessionId === document.document.sessionId && item.dirty && item.document.relativePath.endsWith('.go'))
  if (dirty) return void useGoIDELspStore.setState({ message: 'Move Symbol: save all Go files first, the move is computed from the files on disk.' })
  const word = model.getWordAtPosition(position)?.word ?? 'symbol'
  openRequest?.({ sessionId: document.document.sessionId, relativePath: document.document.relativePath, line: position.lineNumber, column: position.column, symbol: word })
}

function parentDirectory(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? '' : relativePath.slice(0, index)
}

/**
 * Sposta una dichiarazione di primo livello (con i metodi, se è un tipo) in un altro package del
 * modulo. Il backend verifica cicli, simboli non esportati e compilazione; il risultato passa
 * dall'anteprima delle modifiche come ogni refactoring.
 */
export function GoStudioMoveSymbolDialog() {
  const [request, setRequest] = useState<MoveSymbolRequest | null>(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    openRequest = (next) => { setRequest(next); setTarget(parentDirectory(parentDirectory(next.relativePath))); setError(null) }
    return () => { openRequest = null }
  }, [])
  const close = () => { if (!busy) setRequest(null) }
  useModalFocusTrap(!!request, close, dialogRef)
  if (!request) return null
  const submit = async () => {
    setBusy(true); setError(null)
    try {
      const change = await GoIDEBindings.MoveSymbol(request.sessionId, { relativePath: request.relativePath, line: request.line, column: request.column, targetDirectory: target.trim().replace(/^\.?\/+/, '') })
      setRequest(null)
      useGoIDELspStore.setState({ pendingChange: change })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="go-studio-move-symbol-title" className="w-[520px] max-w-[calc(100vw-32px)] rounded-lg border border-border-1 bg-surface-1 p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <FolderInput size={15} className="text-accent" />
          <h2 id="go-studio-move-symbol-title" className="text-[13px] font-semibold text-text-1">Move <span className="font-mono">{request.symbol}</span> to package</h2>
          <button type="button" onClick={close} aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1"><X size={14} /></button>
        </div>
        <label className="flex flex-col gap-1 text-[11.5px] text-text-3">
          Target folder (relative to the project, created if missing)
          <input autoFocus value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && target.trim() && !busy) void submit() }} placeholder="internal/format" className="gs-input gs-mono" />
        </label>
        <p className="mt-2 text-[11px] leading-4 text-text-4">A type moves with its methods. References and imports are rewritten across the module, and the affected packages are compiled before you see the preview. Moves that would break the build, create an import cycle or need unexported names are refused with the reason.</p>
        {error && <pre role="alert" className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger/10 p-2 text-[11px] text-danger">{error}</pre>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className="gs-btn">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !target.trim()} className="gs-btn gs-btn-primary">{busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'Checking the build…' : 'Preview move'}</button>
        </div>
      </div>
    </div>
  )
}
