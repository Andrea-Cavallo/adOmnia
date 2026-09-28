import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorTextEdit, GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { editorModelUri } from './goStudioModelUri'

function editsFor(edits: GoIDEEditorTextEdit[]): monaco.editor.IIdentifiedSingleEditOperation[] {
  return edits.map((edit) => ({
    range: { startLineNumber: edit.range.startLine, startColumn: edit.range.startColumn, endLineNumber: edit.range.endLine, endColumn: edit.range.endColumn },
    text: edit.text,
    forceMoveMarkers: true,
  }))
}

/**
 * Applica una modifica calcolata da gopls. Più file richiedono conferma tramite anteprima;
 * un solo file viene applicato subito. Nessun file viene salvato: i buffer diventano dirty.
 */
export async function applyGoStudioWorkspaceChange(change: GoIDEWorkspaceChange, confirmed = false): Promise<void> {
  if (change.files.length === 0) {
    useGoIDELspStore.setState({ message: `${change.label || 'Action'}: no changes needed.` })
    return
  }
  if (change.files.length > 1 && !confirmed) {
    useGoIDELspStore.setState({ pendingChange: change })
    return
  }
  const store = useGoIDEStore.getState()
  let documents
  try {
    documents = await Promise.all(change.files.map((file) => store.ensureDocumentLoaded(file.relativePath)))
  } catch (error) {
    useGoIDEStore.setState({ error: `Changes not applied: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  if (documents.some((document) => !document)) {
    useGoIDEStore.setState({ error: 'Changes not applied: a file could not be opened.' })
    return
  }
  const editor = activeGoStudioEditor()
  const activeModelUri = editor?.getModel()?.uri.toString()
  change.files.forEach((file, index) => {
    const document = documents[index]!
    if (editor && activeModelUri === editorModelUri(document.document)) {
      editor.pushUndoStop()
      editor.executeEdits('go-studio', editsFor(file.edits))
      editor.pushUndoStop()
      return
    }
    useGoIDEStore.getState().updateDocument(document.document.id, file.newContent)
  })
}
