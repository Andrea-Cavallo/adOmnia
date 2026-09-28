import type { monaco } from '@/lib/monacoSetup'

const MONACO_ACTIONS = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.find': 'actions.find',
  'edit.replace': 'editor.action.startFindReplaceAction',
  'edit.gotoLine': 'editor.action.gotoLine',
  'edit.toggleComment': 'editor.action.commentLine',
  'nav.declaration': 'editor.action.revealDefinition',
  'nav.typeDeclaration': 'editor.action.goToTypeDefinition',
  'nav.implementation': 'goStudio.gotoImplementation',
  'nav.usages': 'goStudio.findUsages',
  'nav.fileStructure': 'goStudio.fileStructure',
  'nav.quickDefinition': 'goStudio.quickDefinition',
  'nav.showUsages': 'goStudio.showUsages',
  'code.quickDocumentation': 'goStudio.quickDocumentation',
  'code.typeInfo': 'goStudio.typeInfo',
  'code.implementInterface': 'goStudio.implementInterface',
  'code.completion': 'editor.action.triggerSuggest',
  'code.parameterInfo': 'editor.action.triggerParameterHints',
  'code.quickFix': 'goStudio.quickFix',
  'code.rename': 'goStudio.rename',
  'code.reformat': 'goStudio.reformat',
  'code.organizeImports': 'goStudio.organizeImports',
  'code.refactorThis': 'goStudio.refactorThis',
  'code.extractVariable': 'goStudio.extractVariable',
  'code.extractConstant': 'goStudio.extractConstant',
  'code.extractFunction': 'goStudio.extractFunction',
  'code.inline': 'goStudio.inline',
  'code.moveToNewFile': 'goStudio.moveToNewFile',
} as const

export type GoStudioEditorCommand = keyof typeof MONACO_ACTIONS

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null

/** Registra l'editor Monaco montato; restituisce la funzione di deregistrazione. */
export function registerGoStudioEditor(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  activeEditor = editor
  return () => { if (activeEditor === editor) activeEditor = null }
}

export function activeGoStudioEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor
}

export function hasGoStudioEditor(): boolean {
  return activeEditor !== null
}

/** Esegue sull'editor attivo l'azione Monaco reale associata al comando Edit. */
export function runGoStudioEditorCommand(command: GoStudioEditorCommand): boolean {
  if (!activeEditor) return false
  activeEditor.focus()
  const id = MONACO_ACTIONS[command]
  // Le azioni Go Studio sono registrate sull'editor; quelle native passano dal registro comandi,
  // perché in Monaco 0.56 getAction(...).run() su alcune (es. quickFix) non apre nulla.
  const action = id.startsWith('goStudio.') ? activeEditor.getAction(id) : null
  if (action) void action.run()
  else activeEditor.trigger('go-studio-menu', id, null)
  return true
}

export function isGoStudioEditorCommand(id: string): id is GoStudioEditorCommand {
  return id in MONACO_ACTIONS
}
