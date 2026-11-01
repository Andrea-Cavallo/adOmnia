import type { CancellablePromise } from '@wailsio/runtime'
import { monaco } from '@/lib/monacoSetup'
import { requestFormatting, requestOrganizeImports } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { activeCodeStudioEditor } from './codeStudioEditorRegistry'
import { toMonacoEdits } from './codeStudioLanguageFeatures'
import { currentCodeStudioDocumentVersion, flushCodeStudioDocument } from './codeStudioLspSync'
import { editorModelUri, fileUri } from './codeStudioModelUri'
import { applyWhitespaceRules, editorConfigFor, editorConfigText, forgetEditorConfig, parseEditorConfig } from './codeStudioEditorConfig'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'

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
  editor.executeEdits('code-studio-save', toMonacoEdits(edits))
  editor.pushUndoStop()
}

/**
 * Esegue Optimize Imports e Reformat sul file Go attivo prima del salvataggio, se abilitati.
 * Le modifiche passano da Monaco (annullabili con Ctrl+Z) e aggiornano il buffer da salvare.
 */
export async function runSaveActions(documentId: string): Promise<void> {
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
  if (!document || !document.dirty || document.document.readOnly) return
  if (document.document.language === 'toml') return applyTomlFormatting(document)
  if (!document.document.name.endsWith('.go')) return applyNonGoWhitespace(document)
  const lsp = useCodeStudioLspStore.getState()
  const { formatOnSave, organizeImportsOnSave } = lsp.preferences
  if ((!formatOnSave && !organizeImportsOnSave) || lsp.status[document.document.sessionId]?.state !== 'ready') return
  const editor = activeCodeStudioEditor()
  const uri = fileUri(document.document.uri)
  if (!editor || editor.getModel()?.uri.toString() !== editorModelUri(document.document)) return
  const sessionId = document.document.sessionId

  if (organizeImportsOnSave) {
    await flushCodeStudioDocument(documentId)
    const change = await withTimeout(requestOrganizeImports(sessionId, documentId))
    const file = change?.files.find((item) => fileUri(item.uri) === uri)
    if (file) applyToEditor(editor, file.edits)
  }
  if (formatOnSave) {
    await flushCodeStudioDocument(documentId)
    const result = await withTimeout(requestFormatting(sessionId, documentId))
    if (result && currentCodeStudioDocumentVersion(documentId) === result.version) applyToEditor(editor, result.edits)
  }
}

async function applyTomlFormatting(document: GoIDEEditorDocument): Promise<void> {
  // Generic trailing-space removal can change the contents of TOML multiline strings.
  if (!useCodeStudioLspStore.getState().preferences.formatOnSave) return
  const { sessionId, relativePath, id } = document.document
  const config = editorConfigFor(parseEditorConfig(await editorConfigText(sessionId)), relativePath)
  const current = useCodeStudioStore.getState().documents.find(item => item.document.id === id)
  if (!current || current.document.readOnly) return
  const source = current.buffer
  const editor = activeCodeStudioEditor(), model = editor?.getModel()
  const active = model?.uri.toString() === editorModelUri(current.document)
  const options = active ? model?.getOptions() : undefined
  try {
    const { formatTomlInWorker } = await import('@/lib/code-studio/tomlFormatterClient')
    const text = await formatTomlInWorker(source, {
      tabSize: config.indent_size ?? config.tab_width ?? options?.tabSize ?? 2,
      insertSpaces: config.indent_style ? config.indent_style !== 'tab' : options?.insertSpaces ?? true,
      trailingNewline: config.insert_final_newline,
    }, undefined, SAVE_ACTION_TIMEOUT_MS)
    const latest = useCodeStudioStore.getState().documents.find(item => item.document.id === id)
    if (!latest || latest.document.readOnly || latest.buffer !== source || text === source) return
    if (active && editor && model && !model.isDisposed() && editor.getModel() === model && model.getValue() === source) {
      editor.pushUndoStop(); editor.executeEdits('code-studio-save', [{ range: model.getFullModelRange(), text }]); editor.pushUndoStop()
    } else useCodeStudioStore.getState().updateDocument(id, text)
  } catch (error) {
    useCodeStudioLspStore.setState({ message: `${error instanceof Error ? error.message : String(error)}. Saving the unchanged TOML buffer.` })
  }
}

/** Lunghezza della riga senza spazi e tab finali, senza la regex `[ \t]+$` (quadratica sul testo lungo). */
function lengthWithoutTrailingBlanks(line: string): number {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end -= 1
  return end
}

/**
 * File non Go: spazi in coda e newline finale secondo .editorconfig, altrimenti secondo la
 * preferenza Trim Trailing Whitespace. Passa da Monaco quando il file è nell'editor attivo,
 * così Ctrl+Z annulla anche questo; altrimenti aggiorna il buffer da salvare.
 */
async function applyNonGoWhitespace(document: GoIDEEditorDocument): Promise<void> {
  const { sessionId, relativePath, id } = document.document
  if (relativePath === '.editorconfig') forgetEditorConfig(sessionId)
  const config = editorConfigFor(parseEditorConfig(await editorConfigText(sessionId)), relativePath)
  const trim = config.trim_trailing_whitespace ?? useCodeStudioLspStore.getState().preferences.trimTrailingWhitespace
  const current = useCodeStudioStore.getState().documents.find((item) => item.document.id === id)
  if (!current) return
  const next = applyWhitespaceRules(current.buffer, trim, config.insert_final_newline)
  if (next === null) return
  const editor = activeCodeStudioEditor()
  const model = editor?.getModel()
  if (editor && model && model.uri.toString() === editorModelUri(document.document)) {
    // Modifiche minime (solo gli spazi in coda e la newline finale): il cursore resta dov'è.
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = []
    const lineCount = trim ? model.getLineCount() : 0
    for (let line = 1; line <= lineCount; line++) {
      const content = model.getLineContent(line)
      const kept = lengthWithoutTrailingBlanks(content)
      if (kept < content.length) edits.push({ range: new monaco.Range(line, kept + 1, line, content.length + 1), text: '' })
    }
    const last = model.getLineCount()
    if (config.insert_final_newline === true && model.getLineContent(last).length > 0) {
      const column = model.getLineMaxColumn(last)
      edits.push({ range: new monaco.Range(last, column, last, column), text: model.getEOL() })
    }
    editor.pushUndoStop()
    editor.executeEdits('code-studio-save', edits)
    editor.pushUndoStop()
    return
  }
  useCodeStudioStore.getState().updateDocument(id, next)
}
