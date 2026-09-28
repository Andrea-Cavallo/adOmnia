import { create } from 'zustand'

interface GoStudioCursorState {
  line: number
  column: number
  setCursor: (line: number, column: number) => void
}

/**
 * Posizione del cursore dell'editor attivo. Vive fuori dal pannello principale: così ogni tasto
 * aggiorna solo la status bar e non ridisegna l'intero IDE.
 */
export const useGoStudioCursorStore = create<GoStudioCursorState>((set) => ({
  line: 1,
  column: 1,
  setCursor: (line, column) => set({ line, column }),
}))
