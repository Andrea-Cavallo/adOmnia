import { Maximize2, Minimize2, Save } from 'lucide-react'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'

interface GoStudioEditorActionsProps {
  document: GoIDEEditorDocument
  onSave: () => void
}

/** Azioni dell'editor a destra delle tab, come in IntelliJ: nessuna riga in più sopra il codice. */
export function GoStudioEditorActions({ document, onSave }: GoStudioEditorActionsProps) {
  const toggleEditorMaximized = useGoIDEStore((state) => state.toggleEditorMaximized)
  const editorMaximized = useGoIDEStore((state) => !state.layout.projectOpen && !state.layout.structureOpen && !state.layout.bottomOpen)
  const canSave = document.dirty && !document.saving && !document.document.readOnly

  return (
    <div className="flex shrink-0 items-center gap-0.5 pl-1 pr-2">
      <button
        type="button"
        disabled={!canSave}
        onClick={onSave}
        title="Save · Ctrl/Cmd+S"
        aria-label="Save"
        className="go-studio-icon-button h-7 w-7"
      >
        <Save size={14} />
      </button>
      <button
        type="button"
        onClick={toggleEditorMaximized}
        aria-pressed={editorMaximized}
        title={editorMaximized ? 'Restore tool windows · Ctrl+Shift+F12' : 'Maximize editor (hide all tool windows) · Ctrl+Shift+F12'}
        aria-label={editorMaximized ? 'Restore tool windows' : 'Maximize editor'}
        className={`go-studio-icon-button h-7 w-7 ${editorMaximized ? 'is-active' : ''}`}
      >
        {editorMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </div>
  )
}
