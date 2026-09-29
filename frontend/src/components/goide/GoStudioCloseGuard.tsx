import { useEffect, useRef, useState } from 'react'
import { Loader2, Save, Square } from 'lucide-react'
import { confirmGoIDEAppClose, setGoIDEDirtyDocumentCount, subscribeGoIDEAppCloseRequests } from '@/lib/goide-api'
import {
  MAIN_GO_STUDIO_WINDOW, confirmGoIDESessionWindowClose, setGoIDEWindowDirtyDocumentCount, subscribeGoIDEWindowCloseRequests,
} from '@/lib/goide-window-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore } from '@/stores/goide'

interface CloseRequest {
  dirtyDocumentCount: number
  activeRuns: boolean
}

interface GoStudioCloseGuardProps {
  /** Finestra da proteggere: la principale chiude l'app, una separata chiude solo sé stessa. */
  windowId?: string
}

export function GoStudioCloseGuard({ windowId = MAIN_GO_STUDIO_WINDOW }: GoStudioCloseGuardProps) {
  const detached = windowId !== MAIN_GO_STUDIO_WINDOW
  const documents = useGoIDEStore((state) => state.documents)
  const saveDocument = useGoIDEStore((state) => state.saveDocument)
  const dirtyDocuments = documents.filter((document) => document.dirty)
  const [request, setRequest] = useState<CloseRequest | null>(null)
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(!!request, () => setRequest(null), dialogRef)

  useEffect(() => {
    const sync = detached ? setGoIDEWindowDirtyDocumentCount(windowId, dirtyDocuments.length) : setGoIDEDirtyDocumentCount(dirtyDocuments.length)
    void sync.catch(() => undefined)
  }, [detached, dirtyDocuments.length, windowId])

  useEffect(() => {
    if (!detached) return subscribeGoIDEAppCloseRequests((next) => setRequest({ dirtyDocumentCount: next.dirtyDocumentCount, activeRuns: next.activeRuns }))
    // L'evento arriva a tutte le finestre: risponde solo quella che si sta chiudendo.
    return subscribeGoIDEWindowCloseRequests((next) => {
      if (next.windowId === windowId) setRequest({ dirtyDocumentCount: next.dirtyDocumentCount, activeRuns: false })
    })
  }, [detached, windowId])

  if (!request) return null

  const close = async () => {
    setRequest(null)
    await (detached ? confirmGoIDESessionWindowClose(windowId) : confirmGoIDEAppClose())
  }
  const saveAndClose = async () => {
    setSaving(true)
    for (const document of dirtyDocuments) {
      if (!await saveDocument(document.document.id)) {
        setSaving(false)
        return
      }
    }
    setSaving(false)
    await close()
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={() => setRequest(null)}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={detached ? 'Confirm window close' : 'Confirm application close'} tabIndex={-1} className="w-[440px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="p-5">
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-warning/10 text-warning">{dirtyDocuments.length > 0 ? <Save size={16} /> : <Square size={15} />}</div>
          <h2 className="text-[13px] font-semibold text-text-1">{detached ? 'Close this window?' : 'Close adOmnia?'}</h2>
          <p className="mt-1 text-[11px] leading-4 text-text-3">
            {dirtyDocuments.length > 0 && `${dirtyDocuments.length} editor buffer${dirtyDocuments.length === 1 ? ' has' : 's have'} unsaved changes. `}
            {request.activeRuns && 'Active Go processes will be stopped, including their child processes.'}
            {detached && 'The project moves back to the main window.'}
          </p>
          {dirtyDocuments.length > 0 && <div className="mt-3 max-h-28 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-3">{dirtyDocuments.map((document) => <div key={document.document.id} className="truncate">{document.document.relativePath}</div>)}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button type="button" onClick={() => setRequest(null)} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
          <button type="button" onClick={() => void close()} className="h-7 rounded px-3 text-xs text-warning hover:bg-warning/10">{dirtyDocuments.length > 0 ? 'Discard & close' : 'Stop & close'}</button>
          {dirtyDocuments.length > 0 && <button type="button" disabled={saving} onClick={() => void saveAndClose()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{saving && <Loader2 size={11} className="animate-spin" />} Save & close</button>}
        </div>
      </div>
    </div>
  )
}
