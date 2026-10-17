import type { monaco } from '@/lib/monacoSetup'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { GoIDEFileChange, GoIDEWorkspaceChange } from '@/lib/code-studio-lsp-api'
import { confirm } from '@/lib/confirmDialog'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { lineEditsFor } from './codeStudioAIFix'
import { declarationLine, functionAtLine, isTestFile, subjectOfTest, testCounterpart, testNameFor } from './codeStudioGoToTest'
import { runCodeStudioRefactoring } from './codeStudioRefactorings'
import { applyCodeStudioWorkspaceChange } from './codeStudioWorkspaceEdits'

export type CodeStudioGenerator = 'constructor' | 'getters' | 'setters' | 'interface' | 'benchmark' | 'fuzz'

export const CODE_STUDIO_GENERATORS: Record<CodeStudioGenerator, string> = {
  constructor: 'Constructor',
  getters: 'Getters',
  setters: 'Setters',
  interface: 'Extract Interface',
  benchmark: 'Benchmark',
  fuzz: 'Fuzz Test',
}

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
}

function activeGoDocument(): GoIDEEditorDocument | null {
  const state = useCodeStudioStore.getState()
  const sessionId = state.activeSessionId
  const id = sessionId ? state.activeDocumentBySession[sessionId] : null
  const document = state.documents.find((item) => item.document.id === id)
  return document && document.document.relativePath.endsWith('.go') && !document.document.readOnly ? document : null
}

async function loadIfExists(relativePath: string): Promise<GoIDEEditorDocument | null> {
  try {
    return await useCodeStudioStore.getState().ensureDocumentLoaded(relativePath)
  } catch {
    return null
  }
}

function fileChange(document: GoIDEEditorDocument, next: string): GoIDEFileChange {
  const original = document.buffer.replace(/\r\n/g, '\n')
  const { edits, newContent } = lineEditsFor(original, next)
  return { uri: document.document.uri, path: document.document.path, relativePath: document.document.relativePath, documentId: document.document.id, edits, newContent, originalContent: original } as GoIDEFileChange
}

async function revealFunction(relativePath: string, name: string): Promise<void> {
  const store = useCodeStudioStore.getState()
  const documentId = await store.openDocument(relativePath)
  const text = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)?.buffer ?? ''
  const line = text.split(/\r?\n/).findIndex((content) => new RegExp(`^func\\s+(\\([^)]*\\)\\s*)?${name}\\b`).test(content)) + 1
  if (line > 0) await store.openLocation(relativePath, line, 6)
}

/**
 * Generatori di Code → Generate: il codice nasce sul testo dell'editor (anche non salvato)
 * e arriva come modifica annullabile; benchmark e fuzz finiscono nel file _test.go, creato se manca.
 */
export async function runCodeStudioGenerator(editor: monaco.editor.ICodeEditor, kind: CodeStudioGenerator): Promise<void> {
  const document = activeGoDocument()
  const line = editor.getPosition()?.lineNumber
  if (!document || !line) return report('Generate: open a Go file first.')
  const label = CODE_STUDIO_GENERATORS[kind]
  const testPath = testCounterpart(document.document.relativePath)
  const testDocument = kind === 'benchmark' || kind === 'fuzz' ? (testPath ? await loadIfExists(testPath) : null) : null
  try {
    const result = await GoIDEBindings.GenerateGoCode({ kind, text: document.buffer.replace(/\r\n/g, '\n'), line, testText: testDocument?.buffer.replace(/\r\n/g, '\n') ?? '' })
    if (kind !== 'benchmark' && kind !== 'fuzz') {
      await applyCodeStudioWorkspaceChange({ label, files: [fileChange(document, result.text ?? '')] } as GoIDEWorkspaceChange)
      report(`${label}: ${result.symbol} generated. Ctrl+Z undoes it.`)
      return
    }
    if (!testPath) return
    const change = testDocument
      ? fileChange(testDocument, result.testText ?? '')
      : ({ relativePath: testPath, newContent: result.testText ?? '', edits: [], created: true, uri: '', path: '' } as unknown as GoIDEFileChange)
    await applyCodeStudioWorkspaceChange({ label, files: [change] } as GoIDEWorkspaceChange)
    await revealFunction(testPath, result.symbol)
    report(`${label}: ${result.symbol} added to ${testPath}. Missing imports are added on save.`)
  } catch (error) {
    report(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Go to Test: dal codice al suo test e ritorno; se il test manca propone di generarlo con gopls. */
export async function goToTest(editor: monaco.editor.ICodeEditor): Promise<void> {
  const document = activeGoDocument()
  const line = editor.getPosition()?.lineNumber ?? 1
  if (!document) return report('Go to Test: open a Go file first.')
  const path = document.document.relativePath
  const counterpart = testCounterpart(path)
  if (!counterpart) return
  const current = functionAtLine(document.buffer, line)

  if (isTestFile(path)) {
    const target = await loadIfExists(counterpart)
    if (!target) return report(`Go to Test: ${counterpart} does not exist.`)
    const subject = current ? subjectOfTest(current.name).find((ref) => declarationLine(target.buffer, ref) !== null) : undefined
    const targetLine = subject ? declarationLine(target.buffer, subject) ?? 1 : 1
    await useCodeStudioStore.getState().openLocation(counterpart, targetLine, 1)
    return
  }

  const testDocument = await loadIfExists(counterpart)
  const testName = current ? testNameFor(current) : null
  if (testDocument && (!testName || testDocument.buffer.includes(`func ${testName}(`))) {
    if (testName) return revealFunction(counterpart, testName)
    await useCodeStudioStore.getState().openDocument(counterpart)
    return
  }
  if (!current) return report(`Go to Test: ${counterpart} does not exist yet. Put the caret on a function to generate its test.`)
  const approved = await confirm({
    title: `Generate ${testName}?`,
    message: `${current.receiver ? `${current.receiver}.` : ''}${current.name} has no test yet. gopls writes a table-driven test in ${counterpart}.`,
    confirmLabel: 'Generate Test',
  })
  if (!approved) return
  await runCodeStudioRefactoring(editor, 'generateTest')
  await revealFunction(counterpart, testName!)
}
