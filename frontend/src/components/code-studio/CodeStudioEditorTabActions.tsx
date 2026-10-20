import { useState } from 'react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { Ellipsis, Maximize2, Minimize2, Redo2, Save, Undo2 } from 'lucide-react'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { activeCodeStudioEditor, runCodeStudioEditorCommand } from './codeStudioEditorRegistry'

interface CodeStudioEditorTabActionsProps {
  document: GoIDEEditorDocument
  onSave: () => void
}

/** Azioni dell'editor a destra delle tab: nessuna riga in più sopra il codice. */
export function CodeStudioEditorTabActions({ document, onSave }: CodeStudioEditorTabActionsProps) {
  const toggleEditorMaximized = useCodeStudioStore((state) => state.toggleEditorMaximized)
  const editorMaximized = useCodeStudioStore((state) => !state.layout.projectOpen && !state.layout.structureOpen && !state.layout.bottomOpen)
  const canSave = document.dirty && !document.saving && !document.document.readOnly
  const model = activeCodeStudioEditor()?.getModel()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  return (
    <div role="toolbar" aria-label="Editor actions" className="code-studio-editor-actions">
      <button
        type="button"
        disabled={!canSave}
        onClick={onSave}
        title="Save · Ctrl/Cmd+S"
        aria-label="Save"
        className="code-studio-editor-save"
      >
        <Save size={14} /><span>Save</span>
      </button>
      <button type="button" aria-label="More editor actions" aria-haspopup="menu" aria-expanded={!!menu} title="More editor actions" className="code-studio-icon-button h-7 w-7"
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: rect.right - 232, y: rect.bottom + 5 }) }}><Ellipsis size={16} /></button>
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
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={[
        { id: 'undo', label: 'Undo', icon: Undo2, shortcut: 'Ctrl/Cmd+Z', disabled: !model?.canUndo() },
        { id: 'redo', label: 'Redo', icon: Redo2, shortcut: 'Ctrl/Cmd+Shift+Z', disabled: !model?.canRedo() },
      ]} onSelect={(id) => { setMenu(null); runCodeStudioEditorCommand(id === 'undo' ? 'edit.undo' : 'edit.redo') }} onClose={() => setMenu(null)} />}
    </div>
  )
}
