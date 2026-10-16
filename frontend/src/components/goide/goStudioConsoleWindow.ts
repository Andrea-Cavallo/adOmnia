// Finestra della Run console (REFACTOR.md voce 7): si disegna solo la coda recente e le
// righe precedenti si aprono a richiesta. Le righe hanno altezza variabile (testo wrappato),
// quindi niente virtualizzazione a misura: la finestra a coda basta a tenere il DOM piccolo.
export const MAX_RENDERED_LINES = 5000
export const CONSOLE_WINDOW = 1000
export const CONSOLE_WINDOW_STEP = 1000

export interface ConsoleWindow {
  /** Primo indice (di `matchingLines`) da disegnare. */
  start: number
  /** Righe più vecchie non disegnate; la ricerca e "Copy console" usano comunque tutto il buffer. */
  hidden: number
}

/**
 * Dove inizia la porzione disegnata: la coda `windowLines` (mai oltre il cap), con la
 * ricerca attiva si allarga al cap per non nascondere i match vecchi.
 */
export function consoleVisibleStart(total: number, windowLines: number, searching: boolean): ConsoleWindow {
  const bounded = Math.max(CONSOLE_WINDOW_STEP, Math.min(searching ? MAX_RENDERED_LINES : windowLines, MAX_RENDERED_LINES))
  const hidden = Math.max(0, total - bounded)
  return { start: hidden, hidden }
}
