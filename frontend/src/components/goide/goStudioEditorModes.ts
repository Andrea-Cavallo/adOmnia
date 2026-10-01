import type * as monaco from 'monaco-editor'

/** Emulazioni opzionali della tastiera dell'editor; il default è quella di GoLand/VS Code. */
export type GoStudioEditorMode = 'default' | 'vim' | 'emacs'

/**
 * Attiva Vim (monaco-vim) o Emacs (monaco-emacs) sull'editor; le librerie si caricano solo quando servono.
 * Restituisce la funzione che ripristina l'editor normale.
 */
export async function attachEditorMode(editor: monaco.editor.IStandaloneCodeEditor, mode: GoStudioEditorMode, statusNode: HTMLElement | null): Promise<() => void> {
  if (mode === 'vim') {
    const { initVimMode } = await import('monaco-vim')
    const vim = initVimMode(editor, statusNode ?? undefined)
    return () => vim.dispose()
  }
  if (mode === 'emacs') {
    const { EmacsExtension } = await import('monaco-emacs')
    const emacs = new EmacsExtension(editor)
    emacs.start()
    return () => emacs.dispose()
  }
  return () => undefined
}
