import { create } from 'zustand'
import type { GoStudioWhenContext } from '@/lib/goide/when'
import { useGoIDELspStore } from '@/stores/goideLsp'

/**
 * Contesto delle scorciatoie con `when`: dove si trova il focus e in che modalità è l'editor.
 * I termini `vim.normal|insert|visual` arrivano da monaco-vim (evento `vim-mode-change` o barra
 * di stato); senza tracciamento la modalità vim è `normal`, come all'ingresso della modalità.
 */

export type GoStudioVimMode = 'normal' | 'insert' | 'visual'

interface GoStudioWhenState {
  /** Modalità corrente di Vim; null quando l'editor non è in modalità vim. */
  vimMode: GoStudioVimMode | null
  setVimMode: (vimMode: GoStudioVimMode | null) => void
}

export const useGoStudioWhenStore = create<GoStudioWhenState>((set) => ({
  vimMode: null,
  setVimMode: (vimMode) => set({ vimMode }),
}))

/** Modalità Vim dal testo di stato di monaco-vim ("-- INSERT --"): vuoto vuol dire normal. */
export function parseVimMode(text: string): GoStudioVimMode | null {
  const upper = text.toUpperCase()
  if (upper.includes('INSERT') || upper.includes('REPLACE')) return 'insert'
  if (upper.includes('VISUAL')) return 'visual'
  if (upper.includes('NORMAL')) return 'normal'
  return text.trim() ? null : 'normal'
}

interface FocusTarget {
  closest?: (selector: string) => unknown
}

/**
 * Termini del contesto per le condizioni `when`, dal target dell'evento tastiera: `editor`,
 * `input`, `terminal`, `vim`, `emacs` e `vim.normal|insert|visual`.
 */
export function whenContextFor(target: FocusTarget | null, editorMode: 'default' | 'vim' | 'emacs', vimMode: GoStudioVimMode | null): GoStudioWhenContext {
  const closest = (selector: string) => (typeof target?.closest === 'function' ? target.closest(selector) : null)
  const inInput = !!closest('input, textarea, [contenteditable="true"]')
  const inEditor = !!closest('.monaco-editor') && !inInput
  const inTerminal = !!closest('.xterm, [data-go-studio-terminal]')
  const vim = editorMode === 'vim'
  return {
    editor: inEditor,
    input: inInput,
    terminal: inTerminal,
    vim,
    emacs: editorMode === 'emacs',
    'vim.normal': vim && (vimMode ?? 'normal') === 'normal',
    'vim.insert': vim && vimMode === 'insert',
    'vim.visual': vim && vimMode === 'visual',
  }
}

/** Contesto attivo ora, per l'intercettazione dei tasti. */
export function activeWhenContext(target: FocusTarget | null): GoStudioWhenContext {
  return whenContextFor(target, useGoIDELspStore.getState().preferences.editorMode ?? 'default', useGoStudioWhenStore.getState().vimMode)
}
