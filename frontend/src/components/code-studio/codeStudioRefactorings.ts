import type { monaco } from '@/lib/monacoSetup'
import { requestCodeActions, requestResolveCodeAction, type GoIDECodeAction } from '@/lib/code-studio-lsp-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { prepareDocument, toEditorRange } from './codeStudioLanguageFeatures'
import { applyCodeStudioWorkspaceChange } from './codeStudioWorkspaceEdits'

export type CodeStudioRefactoring = 'extractVariable' | 'extractConstant' | 'extractFunction' | 'inline' | 'moveToNewFile' | 'generateTest'

interface RefactoringSpec {
  label: string
  /** Famiglia di code action chiesta a gopls. */
  only: string
  /** Kind accettati: gopls decide cosa è possibile, Code Studio non simula nulla. */
  kinds: string[]
  hint: string
}

export const CODE_STUDIO_REFACTORINGS: Record<CodeStudioRefactoring, RefactoringSpec> = {
  extractVariable: { label: 'Extract Variable', only: 'refactor.extract', kinds: ['refactor.extract.variable', 'refactor.extract.variable-all'], hint: 'select an expression' },
  extractConstant: { label: 'Extract Constant', only: 'refactor.extract', kinds: ['refactor.extract.constant', 'refactor.extract.constant-all'], hint: 'select a constant expression' },
  extractFunction: { label: 'Extract Function/Method', only: 'refactor.extract', kinds: ['refactor.extract.function', 'refactor.extract.method'], hint: 'select one or more complete statements' },
  inline: { label: 'Inline', only: 'refactor.inline', kinds: ['refactor.inline.call', 'refactor.inline.variable', 'refactor.inline'], hint: 'place the caret on a call or a local variable' },
  generateTest: { label: 'Generate Test', only: 'source.addTest', kinds: ['source.addTest'], hint: 'place the caret on an exported or unexported function or method (gopls writes a table-driven test)' },
  moveToNewFile: { label: 'Move to New File', only: 'refactor.extract', kinds: ['refactor.extract.toNewFile'], hint: 'select one or more top-level declarations' },
}

/** Azioni di gopls che realizzano il refactoring, nell'ordine proposto dal server. */
export function refactoringCandidates(actions: GoIDECodeAction[], refactoring: CodeStudioRefactoring): GoIDECodeAction[] {
  const { kinds } = CODE_STUDIO_REFACTORINGS[refactoring]
  return actions.filter((action) => !action.disabled && kinds.some((kind) => action.kind === kind || action.kind?.startsWith(`${kind}.`)))
}

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
}

async function apply(sessionId: string, action: GoIDECodeAction, label: string): Promise<void> {
  const change = await requestResolveCodeAction(sessionId, action.id)
  await applyCodeStudioWorkspaceChange(change)
  if (change.files.length === 1) report(`${label} applied. Shift+F6 renames the new symbol, Ctrl+Z undoes the change.`)
}

/**
 * Esegue un refactoring sulla selezione: una sola azione disponibile si applica subito,
 * più varianti (es. funzione e metodo) aprono il menu dei refactoring di Monaco.
 */
export async function runCodeStudioRefactoring(editor: monaco.editor.ICodeEditor, refactoring: CodeStudioRefactoring): Promise<void> {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model || !selection) return
  const spec = CODE_STUDIO_REFACTORINGS[refactoring]
  const prepared = await prepareDocument(model)
  if (!prepared) return report('gopls is not ready for this file yet.')
  try {
    const actions = await requestCodeActions(prepared.sessionId, prepared.documentId, toEditorRange(selection), [spec.only])
    const candidates = refactoringCandidates(actions, refactoring)
    if (candidates.length === 0) return report(`${spec.label} is not available here: ${spec.hint}.`)
    if (candidates.length === 1) return await apply(prepared.sessionId, candidates[0], spec.label)
    editor.trigger('code-studio', 'editor.action.codeAction', { kind: spec.only, apply: 'never' })
  } catch (error) {
    useCodeStudioStore.setState({ error: error instanceof Error ? error.message : String(error) })
  }
}
