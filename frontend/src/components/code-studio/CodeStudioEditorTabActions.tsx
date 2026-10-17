import { Maximize2, Minimize2, Redo2, Save, Undo2 } from 'lucide-react'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { activeCodeStudioEditor, runCodeStudioEditorCommand } from './codeStudioEditorRegistry'

interface CodeStudioEditorTabActionsProps {
  document: GoIDEEditorDocument
  onSave: () => void
}

/** Azioni dell'editor a destra delle tab, come in IntelliJ: nessuna riga in più sopra il codice. */
export function CodeStudioEditorTabActions({ document, onSave }: CodeStudioEditorTabActionsProps) {
  const toggleEditorMaximized = useCodeStudioStore((state) => state.toggleEditorMaximized)
  const editorMaximized = useCodeStudioStore((state) => !state.layout.projectOpen && !state.layout.structureOpen && !state.layout.bottomOpen)
  const canSave = document.dirty && !document.saving && !document.document.readOnly
  const model = activeCodeStudioEditor()?.getModel()

  return (
    <div className="flex shrink-0 items-center gap-0.5 pl-1 pr-2">
      <button type="button" disabled={!model?.canUndo()} onClick={() => runCodeStudioEditorCommand('edit.undo')} title="Undo · Ctrl/Cmd+Z" aria-label="Undo" className="code-studio-icon-button h-7 w-7"><Undo2 size={14} /></button>
      <button type="button" disabled={!model?.canRedo()} onClick={() => runCodeStudioEditorCommand('edit.redo')} title="Redo · Ctrl/Cmd+Shift+Z" aria-label="Redo" className="code-studio-icon-button h-7 w-7"><Redo2 size={14} /></button>
      <button
        type="button"
        disabled={!canSave}
        onClick={onSave}
        title="Save · Ctrl/Cmd+S"
        aria-label="Save"
        className="code-studio-icon-button h-7 w-7"
      >
        <Save size={14} />
      </button>
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
