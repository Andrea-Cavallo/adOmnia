import { currentActivityPhase, scopedPhase, pollingDelay, useActivityStore, type PollKind } from '@/stores/activity'
/**
 * Timer adattivo che si arresta quando la finestra è nascosta e si aggiorna
 * subito al ritorno visibile. I poller dei pannelli devono consumare risorse
 * solo quando qualcuno può vedere il risultato (REFACTOR.md voci 3 e 11);
 * i processi avviati dall'utente restano attivi, qui si sospendono solo le
 * interrogazioni di aggiornamento della UI.
 */
export function visibleInterval(callback: () => void, intervalMs: number, options: { scope?: string; kind?: PollKind } = {}): () => void {
  let timer = 0, disposed = false
  const delay = () => pollingDelay(intervalMs, currentActivityPhase(options.scope), options.kind)
  const schedule = () => {
    window.clearTimeout(timer)
    if (disposed) return
    const ms = delay()
    if (ms !== null) timer = window.setTimeout(() => { try { if (delay() !== null) callback() } finally { schedule() } }, ms)
  }
  const refresh = () => {
    window.clearTimeout(timer)
    if (disposed) return
    if (delay() !== null) callback()
    schedule()
  }
  const off = useActivityStore.subscribe((state, previous) => {
    const phase = scopedPhase(state, options.scope), before = scopedPhase(previous, options.scope)
    if (phase !== before) { if (phase === 'Active') refresh(); else schedule() }
  })
  schedule()
  return () => {
    disposed = true; window.clearTimeout(timer); off()
  }
}

/**
 * Timer allineato al cambio di minuto: l'orologio della Hub mostra solo
 * ore e minuti, quindi un tick al secondo era lavoro inutile (voce 3).
 */
export function minuteAlignedTimeout(callback: () => void): () => void {
  let handle = 0
  const schedule = () => {
    window.clearTimeout(handle)
    if (currentActivityPhase() !== 'Active') return
    handle = window.setTimeout(() => { callback(); schedule() }, 60_000 - (Date.now() % 60_000))
  }
  const off = useActivityStore.subscribe((state, previous) => {
    if (state.phase === previous.phase) return
    if (state.phase === 'Active') callback()
    schedule()
  })
  schedule()
  return () => { off(); window.clearTimeout(handle) }
}
