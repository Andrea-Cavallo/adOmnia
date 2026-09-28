import type { CancellablePromise } from '@wailsio/runtime'
import { monaco } from '@/lib/monacoSetup'
import { requestFormatting, requestOrganizeImports } from '@/lib/goide-lsp-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { toMonacoEdits } from './goStudioLanguageFeatures'
import { currentGoStudioDocumentVersion, flushGoStudioDocument } from './goStudioLspSync'
import { editorModelUri, fileUri } from './goStudioModelUri'

/** Un salvataggio non deve mai restare bloccato da gopls: oltre questo limite si salva senza azioni. */
const SAVE_ACTION_TIMEOUT_MS = 2_500

async function withTimeout<T>(request: CancellablePromise<T>): Promise<T | null> {
  const timer = window.setTimeout(() => void request.cancel(), SAVE_ACTION_TIMEOUT_MS)
  try {
    return await request
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

function applyToEditor(editor: monaco.editor.IStandaloneCodeEditor, edits: Parameters<typeof toMonacoEdits>[0]): void {
  if (edits.length === 0) return
  editor.pushUndoStop()
  editor.executeEdits('go-studio-save', toMonacoEdits(edits))
  editor.pushUndoStop()
}

/**
 * Esegue Optimize Imports e Reformat sul file Go attivo prima del salvataggio, se abilitati.
 * Le modifiche passano da Monaco (annullabili con Ctrl+Z) e aggiornano il buffer da salvare.
 */
export async function runSaveActions(documentId: string): Promise<void> {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
  if (!document || !document.dirty || document.document.readOnly || !document.document.name.endsWith('.go')) return
  const lsp = useGoIDELspStore.getState()
  const { formatOnSave, organizeImportsOnSave } = lsp.preferences
  if ((!formatOnSave && !organizeImportsOnSave) || lsp.status[document.document.sessionId]?.state !== 'ready') return
  const editor = activeGoStudioEditor()
  const uri = fileUri(document.document.uri)
  if (!editor || editor.getModel()?.uri.toString() !== editorModelUri(document.document)) return
  const sessionId = document.document.sessionId

  if (organizeImportsOnSave) {
    await flushGoStudioDocument(documentId)
    const change = await withTimeout(requestOrganizeImports(sessionId, documentId))
    const file = change?.files.find((item) => fileUri(item.uri) === uri)
    if (file) applyToEditor(editor, file.edits)
  }
  if (formatOnSave) {
    await flushGoStudioDocument(documentId)
    const result = await withTimeout(requestFormatting(sessionId, documentId))
    if (result && currentGoStudioDocumentVersion(documentId) === result.version) applyToEditor(editor, result.edits)
  }
}
