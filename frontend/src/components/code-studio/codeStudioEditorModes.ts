import type * as monaco from 'monaco-editor'
import { parseVimMode, type CodeStudioVimMode } from '@/stores/codeStudioWhenContext'

/** Emulazioni opzionali della tastiera dell'editor; il default è quella standard. */
export type CodeStudioEditorMode = 'default' | 'vim' | 'emacs'

/**
 * Attiva Vim (monaco-vim) o Emacs (monaco-emacs) sull'editor; le librerie si caricano solo quando
 * servono. Restituisce la funzione che ripristina l'editor normale. `onVimMode` segnala la
 * sotto-modalità Vim (normal/insert/visual) per le scorciatoie con condizione `when`.
 */
export async function attachEditorMode(editor: monaco.editor.IStandaloneCodeEditor, mode: CodeStudioEditorMode, statusNode: HTMLElement | null, onVimMode?: (mode: CodeStudioVimMode | null) => void): Promise<() => void> {
  if (mode === 'vim') {
    const { initVimMode } = await import('monaco-vim')
    const vim = initVimMode(editor, statusNode ?? undefined)
    onVimMode?.('normal')
    const report = (event: { mode: string }) => {
      onVimMode?.(parseVimMode(event.mode))
    }
    // monaco-vim emits on the adapter, not as DOM events on its status element.
    vim.on('vim-mode-change', report)
    return () => {
      vim.off('vim-mode-change', report)
      vim.dispose()
      onVimMode?.(null)
    }
  }
  if (mode === 'emacs') {
    const { EmacsExtension } = await import('monaco-emacs')
    const emacs = new EmacsExtension(editor)
    emacs.start()
    return () => emacs.dispose()
  }
  return () => undefined
}
