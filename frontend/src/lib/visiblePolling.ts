/**
 * setInterval che salta i tick quando la finestra è nascosta e si aggiorna
 * subito al ritorno visibile. I poller dei pannelli devono consumare risorse
 * solo quando qualcuno può vedere il risultato (REFACTOR.md voci 3 e 11);
 * i processi avviati dall'utente restano attivi, qui si sospendono solo le
 * interrogazioni di aggiornamento della UI.
 */
export function visibleInterval(callback: () => void, intervalMs: number): () => void {
  const tick = () => {
    if (!document.hidden) callback()
  }
  const onVisibilityChange = () => {
    if (!document.hidden) callback()
  }
  const id = window.setInterval(tick, intervalMs)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/**
 * Timer allineato al cambio di minuto: l'orologio della Hub mostra solo
 * ore e minuti, quindi un tick al secondo era lavoro inutile (voce 3).
 */
export function minuteAlignedTimeout(callback: () => void): () => void {
  let handle = 0
  const schedule = () => {
    handle = window.setTimeout(() => {
      callback()
      schedule()
    }, 60_000 - (Date.now() % 60_000))
  }
  schedule()
  return () => window.clearTimeout(handle)
}
