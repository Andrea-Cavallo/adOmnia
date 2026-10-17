import type * as monaco from 'monaco-editor'
import { parseVimMode, type CodeStudioVimMode } from '@/stores/codeStudioWhenContext'

/** Emulazioni opzionali della tastiera dell'editor; il default è quella di GoLand/VS Code. */
export type CodeStudioEditorMode = 'default' | 'vim' | 'emacs'

/**
 * Attiva Vim (monaco-vim) o Emacs (monaco-emacs) sull'editor; le librerie si caricano solo quando
 * servono. Restituisce la funzione che ripristina l'editor normale. `onVimMode` segnala la
 * sotto-modalità Vim (normal/insert/visual) per le scorciatoie con condizione `when`.
 */
export async function attachEditorMode(editor: monaco.editor.IStandaloneCodeEditor, mode: CodeStudioEditorMode, statusNode: HTMLElement | null, onVimMode?: (mode: CodeStudioVimMode | null) => void): Promise<() => void> {
  if (mode === 'vim') {
    const { initVimMode } = await import('monaco-vim')
    const vim = initVimMode(editor, statusNode ?? undefined) as unknown as { dispose: () => void; statusInput?: HTMLInputElement }
    onVimMode?.('normal')
    const source = vim.statusInput ?? statusNode
    const report = (event?: Event) => {
      const detail = (event as CustomEvent<{ mode?: string }> | undefined)?.detail
      const text = detail?.mode ?? vim.statusInput?.value ?? statusNode?.textContent ?? ''
      onVimMode?.(parseVimMode(text))
    }
    report()
    source?.addEventListener('vim-mode-change', report)
    source?.addEventListener('input', report)
    return () => {
      source?.removeEventListener('vim-mode-change', report)
      source?.removeEventListener('input', report)
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
