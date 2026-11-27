import { isMonacoLoaded, monaco } from '@/lib/monacoRef'
import type { GoIDEEditorTextEdit, GoIDEWorkspaceChange } from '@/lib/code-studio-lsp-api'
import { createGoIDEFiles } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { editorModelUri } from './codeStudioModelUri'
import { applyTextEdits } from './codeStudioChangePreview'
import { useWorkspaceHistory } from '@/stores/codeStudioWorkspaceHistory'
import { workspaceHistoryConflicts, type WorkspaceHistoryFile } from '@/lib/code-studio/workspaceHistory'

export { applyTextEdits }

function replaceBuffer(documentId: string, content: string, edits?: GoIDEEditorTextEdit[]): void {
  const store = useCodeStudioStore.getState()
  const document = store.documents.find(item => item.document.id === documentId)
  const model = document && isMonacoLoaded() ? monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document))) : null
  if (model) {
    model.pushStackElement()
    const operations = edits?.length ? edits.map(edit => ({
      range: { startLineNumber: edit.range.startLine, startColumn: edit.range.startColumn, endLineNumber: edit.range.endLine, endColumn: edit.range.endColumn },
      text: edit.text, forceMoveMarkers: true,
    })) : [{ range: model.getFullModelRange(), text: content }]
    model.pushEditOperations([], operations, () => null)
    model.pushStackElement()
  }
  store.updateDocument(documentId, model?.getValue() ?? content)
}

export function restoreWorkspaceChange(redo = false): void {
  const state = useCodeStudioStore.getState()
  const sessionId = state.activeSessionId
  if (!sessionId) return
  const history = useWorkspaceHistory.getState().sessions[sessionId]
  const entries = redo ? history?.redo : history?.undo
  const entry = entries?.[entries.length - 1]
  if (!entry) return useCodeStudioLspStore.setState({ message: `No workspace change to ${redo ? 'redo' : 'undo'}.` })
  const buffers = new Map(state.documents.filter(item => item.document.sessionId === sessionId && !item.document.readOnly && !item.document.external)
    .map(item => {
      const model = isMonacoLoaded() ? monaco.editor.getModel(monaco.Uri.parse(editorModelUri(item.document))) : null
      return [item.document.id, model?.getValue() ?? item.buffer] as const
    }))
  const conflicts = workspaceHistoryConflicts(entry, buffers, redo)
  if (conflicts.length) return useCodeStudioStore.setState({ error: `Cannot ${redo ? 'redo' : 'undo'} ${entry.label}: ${conflicts.join(', ')} changed or closed. No files were modified.` })
  for (const file of entry.files) replaceBuffer(file.documentId, redo ? file.after : file.before)
  useWorkspaceHistory.getState().move(sessionId, redo)
  useCodeStudioLspStore.setState({ message: `${entry.label} ${redo ? 'redone' : 'undone'} in ${entry.files.length} files. Changes remain in the editor until saved.` })
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/**
 * true se gli edit applicati al buffer attuale producono il contenuto calcolato da gopls:
 * se l'utente ha scritto nel frattempo, la modifica è obsoleta e non va applicata a metà.
 */
export function changeMatchesBuffer(buffer: string, edits: GoIDEEditorTextEdit[], newContent: string): boolean {
  const current = normalizeLineEndings(buffer)
  return normalizeLineEndings(applyTextEdits(current, edits)) === normalizeLineEndings(newContent)
}

/**
 * Multiple files require preview. Existing files become dirty buffers; new files are created on disk.
 */
export async function applyCodeStudioWorkspaceChange(change: GoIDEWorkspaceChange, confirmed = false): Promise<void> {
  if (change.files.length === 0) {
    useCodeStudioLspStore.setState({ message: `${change.label || 'Action'}: no changes needed.` })
    return
  }
  if (change.files.length > 1 && !confirmed) {
    useCodeStudioLspStore.setState({ pendingChange: change })
    return
  }
  const store = useCodeStudioStore.getState()
  const sessionId = store.activeSessionId
  if (!sessionId) return
  // I file nuovi (es. Move to New File) non hanno un buffer: si creano su disco, gli altri si modificano in editor.
  const created = change.files.filter((file) => file.created)
  const existing = change.files.filter((file) => !file.created)
  let documents
  try {
    documents = await Promise.all(existing.map((file) => store.ensureDocumentLoaded(file.relativePath)))
  } catch (error) {
    useCodeStudioStore.setState({ error: `Changes not applied: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  if (documents.some((document) => !document)) {
    useCodeStudioStore.setState({ error: 'Changes not applied: a file could not be opened.' })
    return
  }
  if (useCodeStudioStore.getState().activeSessionId !== sessionId) {
    useCodeStudioStore.setState({ error: 'Changes not applied: the active project changed.' })
    return
  }
  documents = documents.map(document => useCodeStudioStore.getState().documents.find(item => item.document.id === document!.document.id) ?? null)
  if (documents.some(document => !document || document.document.sessionId !== sessionId || document.document.readOnly || document.document.external)) {
    useCodeStudioStore.setState({ error: 'Changes not applied: a document closed or is not editable in this project.' })
    return
  }
  documents = documents.map(document => {
    const model = isMonacoLoaded() ? monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document!.document))) : null
    return model ? { ...document!, buffer: model.getValue() } : document
  })
  // Tutto o niente: si verifica ogni file prima di toccarne anche uno solo.
  const stale = existing.filter((file, index) => !changeMatchesBuffer(documents[index]!.buffer, file.edits, file.newContent))
  if (stale.length > 0) {
    useCodeStudioStore.setState({ error: `Changes not applied: ${stale.map((file) => file.relativePath).join(', ')} changed while gopls was computing them. Try again.` })
    return
  }
  if (created.length > 0) {
    try {
      if (!sessionId) throw new Error('no project is open')
      await createGoIDEFiles(sessionId, created.map((file) => ({ relativePath: file.relativePath, content: file.newContent })))
    } catch (error) {
      useCodeStudioStore.setState({ error: `Changes not applied: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
  }
  const historyFiles: WorkspaceHistoryFile[] = existing.map((file, index) => ({
    documentId: documents[index]!.document.id, relativePath: file.relativePath,
    before: documents[index]!.buffer, after: file.newContent,
  }))
  const latest = useCodeStudioStore.getState()
  if (latest.activeSessionId !== sessionId || historyFiles.some(file => {
    const document = latest.documents.find(item => item.document.id === file.documentId)
    return !document || document.buffer !== file.before || document.document.readOnly || document.document.external
  })) {
    useWorkspaceHistory.getState().clear(sessionId)
    useCodeStudioStore.setState({ error: created.length
      ? 'New files were created, but the project or a buffer changed. Existing buffers were left unchanged.'
      : 'Changes not applied: the project or a buffer changed.' })
    return
  }
  existing.forEach((file, index) => {
    const document = documents[index]!
    replaceBuffer(document.document.id, file.newContent, file.edits)
  })
  for (const file of historyFiles) file.after = useCodeStudioStore.getState().documents.find(item => item.document.id === file.documentId)?.buffer ?? file.after
  if (created.length === 0 && historyFiles.length > 1) {
    useWorkspaceHistory.getState().record(sessionId, { label: change.label || 'Refactoring', files: historyFiles })
    const retained = useWorkspaceHistory.getState().sessions[sessionId].undo.length > 0
    useCodeStudioLspStore.setState({ message: retained
      ? `${change.label || 'Refactoring'} applied. Edit → Undo Workspace Change restores all ${historyFiles.length} files together.`
      : `${change.label || 'Refactoring'} applied. This change exceeds the workspace history memory limit.` })
  } else {
    // A structural change invalidates older snapshots; it must not leave a misleading Undo target.
    useWorkspaceHistory.getState().clear(sessionId)
    if (created.length) useCodeStudioLspStore.setState({ message: `${change.label || 'Refactoring'} applied. Workspace Undo is not available for changes that create files.` })
  }
}
