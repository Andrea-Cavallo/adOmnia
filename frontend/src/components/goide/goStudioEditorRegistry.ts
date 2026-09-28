import type { monaco } from '@/lib/monacoSetup'

const MONACO_ACTIONS = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.find': 'actions.find',
  'edit.replace': 'editor.action.startFindReplaceAction',
  'edit.gotoLine': 'editor.action.gotoLine',
  'edit.toggleComment': 'editor.action.commentLine',
} as const

export type GoStudioEditorCommand = keyof typeof MONACO_ACTIONS

let activeEditor: monaco.editor.IStandaloneCodeEditor | null = null

/** Registra l'editor Monaco montato; restituisce la funzione di deregistrazione. */
export function registerGoStudioEditor(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  activeEditor = editor
  return () => { if (activeEditor === editor) activeEditor = null }
}

export function hasGoStudioEditor(): boolean {
  return activeEditor !== null
}

/** Esegue sull'editor attivo l'azione Monaco reale associata al comando Edit. */
export function runGoStudioEditorCommand(command: GoStudioEditorCommand): boolean {
  if (!activeEditor) return false
  activeEditor.focus()
  activeEditor.trigger('go-studio-menu', MONACO_ACTIONS[command], null)
  return true
}

export function isGoStudioEditorCommand(id: string): id is GoStudioEditorCommand {
  return id in MONACO_ACTIONS
}
