import { monaco } from '@/lib/monacoSetup'
import { requestLocations, requestOrganizeImports, type GoIDELocationKind } from '@/lib/goide-lsp-api'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { navigateToLocation, prepareDocument } from './goStudioLanguageFeatures'
import { applyGoStudioWorkspaceChange } from './goStudioWorkspaceEdits'
import { showQuickDefinition, showTypeInfo, showUsagesPopup } from './goStudioSemanticFeatures'
import { requestImplementInterface } from './goStudioImplementInterface'
import { runGoStudioRefactoring, type GoStudioRefactoring } from './goStudioRefactorings'

export const GO_STUDIO_ACTIONS = {
  findUsages: 'goStudio.findUsages',
  gotoImplementation: 'goStudio.gotoImplementation',
  gotoDeclaration: 'goStudio.gotoDeclaration',
  rename: 'goStudio.rename',
  organizeImports: 'goStudio.organizeImports',
  reformat: 'goStudio.reformat',
  quickFix: 'goStudio.quickFix',
  fileStructure: 'goStudio.fileStructure',
  quickDocumentation: 'goStudio.quickDocumentation',
  quickDefinition: 'goStudio.quickDefinition',
  showUsages: 'goStudio.showUsages',
  typeInfo: 'goStudio.typeInfo',
  implementInterface: 'goStudio.implementInterface',
  refactorThis: 'goStudio.refactorThis',
  extractVariable: 'goStudio.extractVariable',
  extractConstant: 'goStudio.extractConstant',
  extractFunction: 'goStudio.extractFunction',
  inline: 'goStudio.inline',
  moveToNewFile: 'goStudio.moveToNewFile',
} as const

const { KeyMod, KeyCode } = monaco

function report(message: string): void {
  useGoIDELspStore.setState({ message })
}

function wordAt(editor: monaco.editor.ICodeEditor): string {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return 'symbol'
  return model.getWordAtPosition(position)?.word ?? 'symbol'
}

async function showLocations(editor: monaco.editor.ICodeEditor, kind: GoIDELocationKind, title: string): Promise<void> {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return
  const prepared = await prepareDocument(model)
  if (!prepared) return report('gopls is not ready for this file yet.')
  try {
    const locations = await requestLocations(prepared.sessionId, prepared.documentId, kind, position.lineNumber, position.column)
    if (locations.length === 0) return report(`${title}: nothing found.`)
    if (kind === 'implementation' && locations.length === 1) return navigateToLocation(locations[0])
    useGoIDELspStore.getState().showReferences(prepared.sessionId, { title, locations })
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

async function organizeImports(editor: monaco.editor.ICodeEditor): Promise<void> {
  const model = editor.getModel()
  if (!model) return
  const prepared = await prepareDocument(model)
  if (!prepared) return report('gopls is not ready for this file yet.')
  try {
    await applyGoStudioWorkspaceChange(await requestOrganizeImports(prepared.sessionId, prepared.documentId))
  } catch (error) {
    report(error instanceof Error ? error.message : String(error))
  }
}

function requestRename(editor: monaco.editor.ICodeEditor): void {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return
  void prepareDocument(model).then((prepared) => {
    if (!prepared) return report('gopls is not ready for this file yet.')
    useGoIDELspStore.setState({ renameRequest: { sessionId: prepared.sessionId, documentId: prepared.documentId, line: position.lineNumber, column: position.column } })
  })
}

/** Registra sull'editor le azioni semantiche Go Studio; le keybinding aggiunte hanno precedenza su quelle native. */
export function installGoStudioEditorActions(editor: monaco.editor.IStandaloneCodeEditor): void {
  const semantic = (id: string, label: string, keybindings: number[], run: (target: monaco.editor.ICodeEditor) => void | Promise<void>) => {
    editor.addAction({ id, label, keybindings, contextMenuGroupId: 'navigation', run: (target) => { void run(target) } })
  }
  semantic(GO_STUDIO_ACTIONS.gotoDeclaration, 'Go to Declaration', [KeyMod.CtrlCmd | KeyCode.KeyB], (target) => target.trigger('go-studio', 'editor.action.revealDefinition', null))
  semantic(GO_STUDIO_ACTIONS.gotoImplementation, 'Go to Implementation', [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB], (target) => showLocations(target, 'implementation', `Implementations of ${wordAt(target)}`))
  semantic(GO_STUDIO_ACTIONS.findUsages, 'Find Usages', [KeyMod.Alt | KeyCode.F7, KeyMod.Shift | KeyCode.F12], (target) => showLocations(target, 'references', `Usages of ${wordAt(target)}`))
  semantic(GO_STUDIO_ACTIONS.rename, 'Rename Symbol…', [KeyCode.F2, KeyMod.Shift | KeyCode.F6], requestRename)
  editor.addAction({ id: GO_STUDIO_ACTIONS.organizeImports, label: 'Optimize Imports', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyO], contextMenuGroupId: '1_modification', run: (target) => { void organizeImports(target) } })
  editor.addAction({ id: GO_STUDIO_ACTIONS.reformat, label: 'Reformat Code', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyL], contextMenuGroupId: '1_modification', run: (target) => { target.trigger('go-studio', 'editor.action.formatDocument', null) } })
  editor.addAction({ id: GO_STUDIO_ACTIONS.quickFix, label: 'Show Context Actions', keybindings: [KeyMod.Alt | KeyCode.Enter], run: (target) => { target.trigger('go-studio', 'editor.action.quickFix', null) } })
  editor.addAction({ id: GO_STUDIO_ACTIONS.quickDocumentation, label: 'Quick Documentation', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyQ], run: (target) => { target.trigger('go-studio', 'editor.action.showHover', { focus: true }) } })
  semantic(GO_STUDIO_ACTIONS.quickDefinition, 'Quick Definition', [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI], showQuickDefinition)
  semantic(GO_STUDIO_ACTIONS.showUsages, 'Show Usages', [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.F7], showUsagesPopup)
  editor.addAction({ id: GO_STUDIO_ACTIONS.typeInfo, label: 'Type Info', keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP], run: (target) => { void showTypeInfo(target) } })
  editor.addAction({ id: GO_STUDIO_ACTIONS.implementInterface, label: 'Implement Interface…', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyI], contextMenuGroupId: '1_modification', run: (target) => { void requestImplementInterface(target) } })
  // Refactoring: solo ciò che gopls offre per la selezione; le scorciatoie sono quelle di GoLand.
  editor.addAction({ id: GO_STUDIO_ACTIONS.refactorThis, label: 'Refactor This…', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyT], contextMenuGroupId: '1_modification', run: (target) => { target.trigger('go-studio', 'editor.action.refactor', null) } })
  const refactoring = (id: string, label: string, keybinding: number, kind: GoStudioRefactoring) => {
    editor.addAction({ id, label, keybindings: [keybinding], run: (target) => { void runGoStudioRefactoring(target, kind) } })
  }
  refactoring(GO_STUDIO_ACTIONS.extractVariable, 'Extract Variable', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyV, 'extractVariable')
  refactoring(GO_STUDIO_ACTIONS.extractConstant, 'Extract Constant', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyC, 'extractConstant')
  refactoring(GO_STUDIO_ACTIONS.extractFunction, 'Extract Function/Method', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM, 'extractFunction')
  refactoring(GO_STUDIO_ACTIONS.inline, 'Inline', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN, 'inline')
  refactoring(GO_STUDIO_ACTIONS.moveToNewFile, 'Move to New File', KeyCode.F6, 'moveToNewFile')
  editor.addAction({ id: GO_STUDIO_ACTIONS.fileStructure, label: 'File Structure', keybindings: [KeyMod.CtrlCmd | KeyCode.F12], run: (target) => { target.trigger('go-studio', 'editor.action.quickOutline', null) } })
}
