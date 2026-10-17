// Modello di `stores/codeStudioLsp.ts` per i task lunghi (REFACTOR.md voce 10): scarto stale + cancel.
// Una richiesta superata (nuova scansione, cambio sessione, chiusura del pannello) non deve
// né applicare i risultati né lasciare girare il lavoro backend.

export interface Cancellable {
  cancel: () => void
}

/** Contatore di generazione: ogni avvio prende un token, gli scarti invalidano tutti. */
export class RequestEpoch {
  private current = 0

  /** Token della richiesta che inizia ora. */
  begin(): number {
    this.current += 1
    return this.current
  }

  /** Invalida ogni richiesta in corso (cambio sessione, smontaggio, nuova istruzione). */
  invalidate(): void {
    this.current += 1
  }

  isCurrent(token: number): boolean {
    return token === this.current
  }
}

/** Annulla la richiesta in corso e la dimentica; sicuro da chiamare più volte. */
export function cancelInFlight(ref: { current: Cancellable | null }): void {
  const running = ref.current
  ref.current = null
  if (running) {
    try { running.cancel() } catch { /* annullamento best-effort */ }
  }
}
