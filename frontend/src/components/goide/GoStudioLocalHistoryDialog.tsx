import { useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { History, RotateCcw, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { getGoIDELocalHistoryContent, listGoIDELocalHistory, type GoIDEHistoryRevision } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { editorModelUri } from './goStudioModelUri'
import { relativeTime } from './goStudioTime'

interface GoStudioLocalHistoryDialogProps {
  document: GoIDEEditorDocument | null
  open: boolean
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Local History del file attivo: ogni salvataggio è una versione confrontabile con il buffer attuale.
 * Restore rimette il testo nell'editor come modifica annullabile, senza toccare il disco.
 */
export function GoStudioLocalHistoryDialog({ document, open, onClose }: GoStudioLocalHistoryDialogProps) {
  const theme = useGoStudioEditorTheme()
  const [revisions, setRevisions] = useState<GoIDEHistoryRevision[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const sessionId = document?.document.sessionId ?? ''
  const relativePath = document?.document.relativePath ?? ''

  useEffect(() => {
    if (!open || !document) return
    setError(null)
    setContent(null)
    listGoIDELocalHistory(sessionId, relativePath)
      .then((items) => { setRevisions(items); setSelected(items[0]?.id ?? null) })
      .catch((reason: unknown) => setError(errorMessage(reason)))
  }, [document, open, relativePath, sessionId])

  useEffect(() => {
    if (!open || !selected) return
    getGoIDELocalHistoryContent(sessionId, relativePath, selected)
      .then(setContent)
      .catch((reason: unknown) => setError(errorMessage(reason)))
  }, [open, relativePath, selected, sessionId])

  if (!open || !document) return null

  const restore = () => {
    if (content === null) return
    const editor = activeGoStudioEditor()
    const model = editor?.getModel()
    // Nell'editor attivo il ripristino è un'unica modifica annullabile con Ctrl+Z.
    if (editor && model && model.uri.toString() === editorModelUri(document.document)) {
      editor.pushUndoStop()
      editor.executeEdits('go-studio-local-history', [{ range: model.getFullModelRange(), text: content }])
      editor.pushUndoStop()
      window.setTimeout(() => editor.focus(), 0)
    } else {
      useGoIDEStore.getState().updateDocument(document.document.id, content)
    }
    useGoIDELspStore.setState({ message: `${relativePath} restored from Local History as unsaved changes. Ctrl+Z undoes it.` })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Local History" tabIndex={-1} className="flex h-[min(620px,85vh)] w-[min(1000px,94vw)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <History size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Local History</h2>
          <span className="truncate font-mono text-[10px] text-text-4">{relativePath}</span>
          <span className="ml-2 truncate text-[10px] text-text-4">Saved versions of this project, kept 14 days · secrets files are never recorded</span>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="listbox" aria-label="Versions" className="w-56 shrink-0 overflow-auto border-r border-border-1 py-1">
            {revisions.length === 0 && <p className="px-3 py-3 text-[11px] text-text-4">No saved versions yet. Every save of this file adds one.</p>}
            {revisions.map((revision) => (
              <button key={revision.id} type="button" role="option" aria-selected={revision.id === selected} onClick={() => setSelected(revision.id)}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left ${revision.id === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                <span className="text-[11px]">{relativeTime(revision.savedAt)}</span>
                <span className="text-[9px] text-text-4">{revision.label} · {new Date(revision.savedAt).toLocaleString()} · {revision.bytes} B</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {error && <p role="alert" className="p-3 text-[11px] text-danger">{error}</p>}
            {content !== null && (
              <DiffEditor original={content} modified={document.buffer} language={document.document.language} theme={theme} beforeMount={beforeGoStudioMount}
                originalModelPath={`inmemory://local-history/original/${relativePath}`} modifiedModelPath={`inmemory://local-history/current/${relativePath}`}
                keepCurrentOriginalModel keepCurrentModifiedModel
                options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <span className="mr-auto text-[10px] text-text-4">Left: saved version · Right: current editor</span>
          <button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Close</button>
          <button type="button" disabled={content === null || document.document.readOnly} onClick={restore} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"><RotateCcw size={11} /> Restore this version</button>
        </div>
      </div>
    </div>
  )
}
