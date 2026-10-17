import { monaco } from '@/lib/monacoSetup'
import { requestLocations, requestOrganizeImports, type GoIDELocationKind } from '@/lib/code-studio-lsp-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { navigateToLocation, prepareDocument } from './codeStudioLanguageFeatures'
import { applyCodeStudioWorkspaceChange } from './codeStudioWorkspaceEdits'
import { caretAnchor, showHierarchy, showQuickDefinition, showTypeInfo, showUsagesPopup } from './codeStudioSemanticFeatures'
import { goToTest } from './codeStudioCodeGen'
import { requestImplementInterface } from './codeStudioImplementInterface'
import { runCodeStudioRefactoring, type CodeStudioRefactoring } from './codeStudioRefactorings'
import { goToSuperMethod } from './codeStudioImplementationMarkers'
import { openChangeSignature } from './CodeStudioChangeSignatureDialog'
import { openMoveSymbol } from './CodeStudioMoveSymbolDialog'

export const CODE_STUDIO_ACTIONS = {
  findUsages: 'codeStudio.findUsages',
  gotoImplementation: 'codeStudio.gotoImplementation',
  gotoDeclaration: 'codeStudio.gotoDeclaration',
  rename: 'codeStudio.rename',
  organizeImports: 'codeStudio.organizeImports',
  reformat: 'codeStudio.reformat',
  quickFix: 'codeStudio.quickFix',
  fileStructure: 'codeStudio.fileStructure',
  quickDocumentation: 'codeStudio.quickDocumentation',
  quickDefinition: 'codeStudio.quickDefinition',
  callHierarchy: 'codeStudio.callHierarchy',
  gotoTest: 'codeStudio.gotoTest',
  generate: 'codeStudio.generate',
  typeHierarchy: 'codeStudio.typeHierarchy',
  showUsages: 'codeStudio.showUsages',
  typeInfo: 'codeStudio.typeInfo',
  implementInterface: 'codeStudio.implementInterface',
  superMethod: 'codeStudio.superMethod',
  refactorThis: 'codeStudio.refactorThis',
  extractVariable: 'codeStudio.extractVariable',
  extractConstant: 'codeStudio.extractConstant',
  extractFunction: 'codeStudio.extractFunction',
  inline: 'codeStudio.inline',
  moveToNewFile: 'codeStudio.moveToNewFile',
  changeSignature: 'codeStudio.changeSignature',
  moveSymbol: 'codeStudio.moveSymbol',
} as const

const { KeyMod, KeyCode } = monaco

function report(message: string): void {
  useCodeStudioLspStore.setState({ message })
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
  if (!prepared) return report('The language server is not ready for this file yet.')
  try {
    const locations = await requestLocations(prepared.sessionId, prepared.documentId, kind, position.lineNumber, position.column)
    if (locations.length === 0) return report(`${title}: nothing found.`)
    if (kind === 'implementation' && locations.length === 1) return navigateToLocation(locations[0])
    useCodeStudioLspStore.getState().showReferences(prepared.sessionId, { title, locations })
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
    await applyCodeStudioWorkspaceChange(await requestOrganizeImports(prepared.sessionId, prepared.documentId))
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
    useCodeStudioLspStore.setState({ renameRequest: { sessionId: prepared.sessionId, documentId: prepared.documentId, line: position.lineNumber, column: position.column } })
  })
}

/** Registra sull'editor le azioni semantiche Code Studio; le keybinding aggiunte hanno precedenza su quelle native. */
export function installCodeStudioEditorActions(editor: monaco.editor.IStandaloneCodeEditor): void {
  const semantic = (id: string, label: string, keybindings: number[], run: (target: monaco.editor.ICodeEditor) => void | Promise<void>) => {
    editor.addAction({ id, label, keybindings, contextMenuGroupId: 'navigation', run: (target) => { void run(target) } })
  }
  semantic(CODE_STUDIO_ACTIONS.gotoDeclaration, 'Go to Declaration', [KeyMod.CtrlCmd | KeyCode.KeyB], (target) => target.trigger('code-studio', 'editor.action.revealDefinition', null))
  semantic(CODE_STUDIO_ACTIONS.gotoImplementation, 'Go to Implementation', [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB], (target) => showLocations(target, 'implementation', `Implementations of ${wordAt(target)}`))
  semantic(CODE_STUDIO_ACTIONS.findUsages, 'Find Usages', [KeyMod.Alt | KeyCode.F7, KeyMod.Shift | KeyCode.F12], (target) => showLocations(target, 'references', `Usages of ${wordAt(target)}`))
  semantic(CODE_STUDIO_ACTIONS.rename, 'Rename Symbol…', [KeyCode.F2, KeyMod.Shift | KeyCode.F6], requestRename)
  editor.addAction({ id: CODE_STUDIO_ACTIONS.organizeImports, label: 'Optimize Imports', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyO, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyO], contextMenuGroupId: '1_modification', run: (target) => { void organizeImports(target) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.reformat, label: 'Reformat Code', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyL], contextMenuGroupId: '1_modification', run: (target) => { target.trigger('code-studio', 'editor.action.formatDocument', null) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.quickFix, label: 'Show Context Actions', keybindings: [KeyMod.Alt | KeyCode.Enter], run: (target) => { target.trigger('code-studio', 'editor.action.quickFix', null) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.quickDocumentation, label: 'Quick Documentation', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyQ], run: (target) => { target.trigger('code-studio', 'editor.action.showHover', { focus: true }) } })
  semantic(CODE_STUDIO_ACTIONS.quickDefinition, 'Quick Definition', [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyI], showQuickDefinition)
  semantic(CODE_STUDIO_ACTIONS.showUsages, 'Show Usages', [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.F7], showUsagesPopup)
  editor.addAction({ id: CODE_STUDIO_ACTIONS.typeInfo, label: 'Type Info', keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP], run: (target) => { void showTypeInfo(target) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.implementInterface, label: 'Implement Interface…', keybindings: [KeyMod.CtrlCmd | KeyCode.KeyI], contextMenuGroupId: '1_modification', run: (target) => { void requestImplementInterface(target) } })
  semantic(CODE_STUDIO_ACTIONS.superMethod, 'Go to Super Method', [KeyMod.CtrlCmd | KeyCode.KeyU], goToSuperMethod)
  semantic(CODE_STUDIO_ACTIONS.gotoTest, 'Go to Test', [KeyMod.Alt | KeyMod.Shift | KeyCode.KeyT], goToTest)
  semantic(CODE_STUDIO_ACTIONS.generate, 'Generate…', [KeyMod.Alt | KeyCode.Insert], (target) => {
    const anchor = caretAnchor(target)
    if (anchor) useCodeStudioLspStore.setState({ generateMenu: anchor })
  })
  semantic(CODE_STUDIO_ACTIONS.callHierarchy, 'Call Hierarchy', [KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyH], (target) => showHierarchy(target, 'call'))
  semantic(CODE_STUDIO_ACTIONS.typeHierarchy, 'Type Hierarchy', [], (target) => showHierarchy(target, 'type'))
  // Keymap di GoLand per le azioni di editing di Monaco: stesse azioni native, tasti che lo sviluppatore già conosce.
  const native = (id: string, label: string, keybindings: number[], nativeId: string) => {
    editor.addAction({ id, label, keybindings, run: (target) => { target.trigger('code-studio', nativeId, null) } })
  }
  native('codeStudio.duplicateLine', 'Duplicate Line or Selection', [KeyMod.CtrlCmd | KeyCode.KeyD], 'editor.action.copyLinesDownAction')
  native('codeStudio.deleteLine', 'Delete Line', [KeyMod.CtrlCmd | KeyCode.KeyY], 'editor.action.deleteLines')
  native('codeStudio.moveLineUp', 'Move Line Up', [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow], 'editor.action.moveLinesUpAction')
  native('codeStudio.moveLineDown', 'Move Line Down', [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow], 'editor.action.moveLinesDownAction')
  native('codeStudio.nextOccurrence', 'Add Caret at Next Occurrence', [KeyMod.Alt | KeyCode.KeyJ], 'editor.action.addSelectionToNextFindMatch')
  native('codeStudio.allOccurrences', 'Select All Occurrences', [KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyJ], 'editor.action.selectHighlights')
  native('codeStudio.columnSelection', 'Column Selection Mode', [KeyMod.Alt | KeyMod.Shift | KeyCode.Insert], 'editor.action.toggleColumnSelection')
  // Refactoring: solo ciò che gopls offre per la selezione; le scorciatoie sono quelle di GoLand.
  editor.addAction({ id: CODE_STUDIO_ACTIONS.refactorThis, label: 'Refactor This…', keybindings: [KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyT], contextMenuGroupId: '1_modification', run: (target) => { target.trigger('code-studio', 'editor.action.refactor', null) } })
  const refactoring = (id: string, label: string, keybinding: number, kind: CodeStudioRefactoring) => {
    editor.addAction({ id, label, keybindings: [keybinding], run: (target) => { void runCodeStudioRefactoring(target, kind) } })
  }
  refactoring(CODE_STUDIO_ACTIONS.extractVariable, 'Extract Variable', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyV, 'extractVariable')
  refactoring(CODE_STUDIO_ACTIONS.extractConstant, 'Extract Constant', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyC, 'extractConstant')
  refactoring(CODE_STUDIO_ACTIONS.extractFunction, 'Extract Function/Method', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM, 'extractFunction')
  refactoring(CODE_STUDIO_ACTIONS.inline, 'Inline', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN, 'inline')
  refactoring(CODE_STUDIO_ACTIONS.moveToNewFile, 'Move to New File', KeyCode.F6, 'moveToNewFile')
  editor.addAction({ id: CODE_STUDIO_ACTIONS.changeSignature, label: 'Change Signature…', keybindings: [KeyMod.CtrlCmd | KeyCode.F6], contextMenuGroupId: '1_modification', run: (target) => { void openChangeSignature(target) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.moveSymbol, label: 'Move Symbol to Package…', contextMenuGroupId: '1_modification', run: (target) => { openMoveSymbol(target) } })
  editor.addAction({ id: CODE_STUDIO_ACTIONS.fileStructure, label: 'File Structure', keybindings: [KeyMod.CtrlCmd | KeyCode.F12], run: (target) => { target.trigger('code-studio', 'editor.action.quickOutline', null) } })
}
