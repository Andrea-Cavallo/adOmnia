import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorTextEdit, GoIDEWorkspaceChange } from '@/lib/goide-lsp-api'
import { createGoIDEFiles } from '@/lib/goide-api'
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

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** Applica edit LSP (righe e colonne 1-based, colonne UTF-16) a un testo, dall'ultimo al primo. */
export function applyTextEdits(text: string, edits: GoIDEEditorTextEdit[]): string {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') lineStarts.push(index + 1)
  const offset = (line: number, column: number) => {
    const start = lineStarts[Math.min(Math.max(line, 1), lineStarts.length) - 1]
    return Math.min(start + Math.max(column, 1) - 1, text.length)
  }
  const ordered = [...edits].sort((left, right) => offset(right.range.startLine, right.range.startColumn) - offset(left.range.startLine, left.range.startColumn))
  let result = text
  for (const edit of ordered) {
    result = result.slice(0, offset(edit.range.startLine, edit.range.startColumn)) + edit.text + result.slice(offset(edit.range.endLine, edit.range.endColumn))
  }
  return result
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
  const sessionId = store.activeSessionId
  // I file nuovi (es. Move to New File) non hanno un buffer: si creano su disco, gli altri si modificano in editor.
  const created = change.files.filter((file) => file.created)
  const existing = change.files.filter((file) => !file.created)
  let documents
  try {
    documents = await Promise.all(existing.map((file) => store.ensureDocumentLoaded(file.relativePath)))
  } catch (error) {
    useGoIDEStore.setState({ error: `Changes not applied: ${error instanceof Error ? error.message : String(error)}` })
    return
  }
  if (documents.some((document) => !document)) {
    useGoIDEStore.setState({ error: 'Changes not applied: a file could not be opened.' })
    return
  }
  // Tutto o niente: si verifica ogni file prima di toccarne anche uno solo.
  const stale = existing.filter((file, index) => !changeMatchesBuffer(documents[index]!.buffer, file.edits, file.newContent))
  if (stale.length > 0) {
    useGoIDEStore.setState({ error: `Changes not applied: ${stale.map((file) => file.relativePath).join(', ')} changed while gopls was computing them. Try again.` })
    return
  }
  if (created.length > 0) {
    try {
      if (!sessionId) throw new Error('no project is open')
      await createGoIDEFiles(sessionId, created.map((file) => ({ relativePath: file.relativePath, content: file.newContent })))
    } catch (error) {
      useGoIDEStore.setState({ error: `Changes not applied: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
  }
  const editor = activeGoStudioEditor()
  const activeModelUri = editor?.getModel()?.uri.toString()
  existing.forEach((file, index) => {
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
