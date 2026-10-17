/**
 * Auto save a tempo: dopo una pausa nella digitazione salva i file modificati,
 * come `files.autoSave: afterDelay` di VS Code. Il debounce è lo stesso del
 * crash recovery (goStudioRecovery): nessun salvataggio mentre si scrive.
 */

/** Valori ammessi dalla UI per la preferenza autoSaveDelayMs (ms); 0 disattiva l'auto save a tempo. */
export const AUTO_SAVE_DELAY_OPTIONS = [0, 1000, 2000, 5000, 10000] as const

type AutoSaveHandler = () => void

let delayMs = 0
let handler: AutoSaveHandler | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/** Valore della preferenza: solo numeri finiti tra 0 e 60000 ms, altrimenti 0 (spento). */
export function autoSaveDelayValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 60000) : 0
}

/** Imposta chi esegue il salvataggio (Go Studio salva con le sue save actions). */
export function setAutoSaveHandler(next: AutoSaveHandler | null): void {
  handler = next
}

/** Attiva l'auto save dopo ms di inattività; 0 lo spegne e annulla il salvataggio in attesa. */
export function setAutoSaveDelay(ms: number): void {
  delayMs = autoSaveDelayValue(ms)
  if (!delayMs) cancelAutoSave()
}

/**
 * scheduleAutoSave riavvia il timer a ogni modifica del buffer: il salvataggio
 * parte solo quando l'utente smette di scrivere per autoSaveDelayMs.
 */
export function scheduleAutoSave(): void {
  if (!delayMs || !handler) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    handler?.()
  }, delayMs)
}

/** cancelAutoSave annulla il salvataggio in attesa (auto save disattivato, pannello chiuso). */
export function cancelAutoSave(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** true se un auto save è in attesa (serve a riprovare quando un salvataggio è già in corso). */
export function pendingAutoSave(): boolean {
  return timer !== null
}
