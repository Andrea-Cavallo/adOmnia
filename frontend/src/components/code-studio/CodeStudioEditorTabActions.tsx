import { Loader2, Maximize2, Minimize2, Save } from 'lucide-react'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'

interface CodeStudioEditorTabActionsProps {
  document: GoIDEEditorDocument
  onSave: () => void
}

/** Azioni dell'editor a destra delle tab: nessuna riga in più sopra il codice. */
export function CodeStudioEditorTabActions({ document, onSave }: CodeStudioEditorTabActionsProps) {
  const toggleEditorMaximized = useCodeStudioStore((state) => state.toggleEditorMaximized)
  const editorMaximized = useCodeStudioStore((state) => !state.layout.projectOpen && !state.layout.structureOpen && !state.layout.bottomOpen)
  const canSave = document.dirty && !document.saving && !document.document.readOnly

  return (
    <div role="toolbar" aria-label="Editor actions" className="code-studio-editor-actions">
      <button
        type="button"
        disabled={!canSave}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSave}
        title={document.saveError ? `Save failed: ${document.saveError} · Ctrl/Cmd+S` : document.saving ? 'Saving…' : document.dirty ? 'Save · Ctrl/Cmd+S' : 'All changes saved'}
        aria-label={document.saving ? 'Saving' : 'Save'}
        className="code-studio-icon-button code-studio-editor-save h-7 w-7"
        data-save-state={document.saving ? 'saving' : document.saveError ? 'error' : document.dirty ? 'dirty' : 'clean'}
        aria-busy={document.saving}
        aria-description={document.saveError || undefined}
      >
        {document.saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
      </button>
      <span className="code-studio-editor-action-divider" aria-hidden="true" />
      <button
        type="button"
        onClick={toggleEditorMaximized}
        aria-pressed={editorMaximized}
        title={editorMaximized ? 'Restore tool windows · Ctrl+Shift+F12' : 'Maximize editor (hide all tool windows) · Ctrl+Shift+F12'}
        aria-label={editorMaximized ? 'Restore tool windows' : 'Maximize editor'}
        className={`code-studio-icon-button h-7 w-7 ${editorMaximized ? 'is-active' : ''}`}
      >
        {editorMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  )
}
