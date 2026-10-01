import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { AlertCircle, History, RotateCcw } from 'lucide-react'
import { getGoIDELocalHistoryContent, listGoIDELocalHistory, type GoIDEHistoryRevision } from '@/lib/goide-api'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { editorModelUri } from './goStudioModelUri'
import { relativeTime } from './goStudioTime'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'

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
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="full"
      tall
      divided
      flush
      icon={History}
      title="Local history"
      subtitle={<><span className="gs-mono">{relativePath}</span> · saved versions kept 14 days, secret files never recorded</>}
      footerStart="Left: saved version · Right: current editor"
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>
        <GoStudioButton variant="primary" icon={RotateCcw} disabled={content === null || document.document.readOnly} onClick={restore}>Restore this version</GoStudioButton>
      </>}
    >
      <div className="flex min-h-0 flex-1">
        <div role="listbox" aria-label="Versions" className="w-64 shrink-0 overflow-auto border-r border-border-1 p-1.5">
          {revisions.length === 0 && <p className="gs-list-empty">No saved versions yet. Every save of this file adds one.</p>}
          {revisions.map((revision) => (
            <button key={revision.id} type="button" role="option" aria-selected={revision.id === selected} onClick={() => setSelected(revision.id)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left ${revision.id === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2/60'}`}>
              <span className="text-[12.5px] font-medium">{relativeTime(revision.savedAt)}</span>
              <span className="text-[11.5px] text-text-4">{revision.label} · {new Date(revision.savedAt).toLocaleString()} · {revision.bytes} B</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {error && <div className="p-4"><GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert></div>}
          {content !== null && (
            <DiffEditor original={content} modified={document.buffer} language={document.document.language} theme={theme} beforeMount={beforeGoStudioMount}
              originalModelPath={`inmemory://local-history/original/${relativePath}`} modifiedModelPath={`inmemory://local-history/current/${relativePath}`}
              keepCurrentOriginalModel keepCurrentModifiedModel
              options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12.5 }} />
          )}
        </div>
      </div>
    </GoStudioModal>
  )
}
