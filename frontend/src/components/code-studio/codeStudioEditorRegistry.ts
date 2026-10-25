import type { monaco } from '@/lib/monacoSetup'

const MONACO_ACTIONS = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.find': 'actions.find',
  'edit.replace': 'editor.action.startFindReplaceAction',
  'edit.gotoLine': 'editor.action.gotoLine',
  'edit.toggleComment': 'editor.action.commentLine',
  'edit.duplicateLine': 'editor.action.copyLinesDownAction',
  'edit.deleteLine': 'editor.action.deleteLines',
  'edit.moveLineUp': 'editor.action.moveLinesUpAction',
  'edit.moveLineDown': 'editor.action.moveLinesDownAction',
  'edit.nextOccurrence': 'editor.action.addSelectionToNextFindMatch',
  'edit.allOccurrences': 'editor.action.selectHighlights',
  'edit.columnSelection': 'editor.action.toggleColumnSelection',
  'nav.declaration': 'editor.action.revealDefinition',
  'nav.typeDeclaration': 'editor.action.goToTypeDefinition',
  'nav.implementation': 'codeStudio.gotoImplementation',
  'nav.superMethod': 'codeStudio.superMethod',
  'nav.usages': 'codeStudio.findUsages',
  'nav.fileStructure': 'codeStudio.fileStructure',
  'nav.quickDefinition': 'codeStudio.quickDefinition',
  'nav.showUsages': 'codeStudio.showUsages',
  'nav.callHierarchy': 'codeStudio.callHierarchy',
  'nav.gotoTest': 'codeStudio.gotoTest',
  'code.generate': 'codeStudio.generate',
  'nav.typeHierarchy': 'codeStudio.typeHierarchy',
  'nav.nextProblem': 'editor.action.marker.nextInFiles',
  'nav.previousProblem': 'editor.action.marker.prevInFiles',
  'code.quickDocumentation': 'codeStudio.quickDocumentation',
  'code.typeInfo': 'codeStudio.typeInfo',
  'code.implementInterface': 'codeStudio.implementInterface',
  'code.completion': 'editor.action.triggerSuggest',
  'code.parameterInfo': 'editor.action.triggerParameterHints',
  'code.quickFix': 'codeStudio.quickFix',
  'code.rename': 'codeStudio.rename',
  'code.reformat': 'codeStudio.reformat',
  'code.organizeImports': 'codeStudio.organizeImports',
  'code.refactorThis': 'codeStudio.refactorThis',
  'code.extractVariable': 'codeStudio.extractVariable',
  'code.extractConstant': 'codeStudio.extractConstant',
  'code.extractFunction': 'codeStudio.extractFunction',
  'code.inline': 'codeStudio.inline',
  'code.moveToNewFile': 'codeStudio.moveToNewFile',
  'code.changeSignature': 'codeStudio.changeSignature',
  'code.moveSymbol': 'codeStudio.moveSymbol',
} as const

export type CodeStudioEditorCommand = keyof typeof MONACO_ACTIONS

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null
const mountedEditors = new Set<monaco.editor.IStandaloneCodeEditor>()

/** Registra l'editor Monaco montato; restituisce la funzione di deregistrazione. */
const editorListeners = new Set<() => void>()

/** For useSyncExternalStore: menus re-check "an editor is open" when one mounts or goes away. */
export function subscribeCodeStudioEditor(listener: () => void): () => void {
  editorListeners.add(listener)
  return () => { editorListeners.delete(listener) }
}

function setActiveEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
  if (activeEditor === editor) return
  activeEditor = editor
  editorListeners.forEach((listener) => listener())
}

export function registerCodeStudioEditor(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  mountedEditors.add(editor)
  setActiveEditor(editor)
  return () => {
    mountedEditors.delete(editor)
    if (activeEditor === editor) setActiveEditor(null)
  }
}

export function activeCodeStudioEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor
}

export function hasCodeStudioEditor(): boolean {
  return activeEditor !== null
}

/** Esegue sull'editor attivo l'azione Monaco reale associata al comando Edit. */
export function runCodeStudioEditorCommand(command: CodeStudioEditorCommand, modelUri?: string): boolean {
  const editor = modelUri ? [...mountedEditors].find((item) => item.getModel()?.uri.toString() === modelUri) : activeEditor
  if (!editor) return false
  editor.focus()
  const id = MONACO_ACTIONS[command]
  // Le azioni Code Studio sono registrate sull'editor; quelle native passano dal registro comandi,
  // perché in Monaco 0.56 getAction(...).run() su alcune (es. quickFix) non apre nulla.
  const action = id.startsWith('codeStudio.') ? editor.getAction(id) : null
  if (action) void action.run()
  else editor.trigger('code-studio-menu', id, null)
  return true
}

export function isCodeStudioEditorCommand(id: string): id is CodeStudioEditorCommand {
  return id in MONACO_ACTIONS
}
