/**
 * Raggruppa l'output di un processo prima di passarlo a uno store: il primo elemento arriva subito
 * (l'eco di un programma interattivo resta immediata), poi al massimo un aggiornamento ogni `intervalMs`.
 * Un `set` per evento fa ricalcolare ogni selettore dello store e si paga digitando nell'editor.
 */
export interface OutputBatcher<T> {
  add: (item: T) => void
  /** Consegna subito ciò che aspetta: va chiamato prima di un evento che deve seguire l'output. */
  flush: () => void
}

export function createOutputBatcher<T>(deliver: (items: T[]) => void, intervalMs: number): OutputBatcher<T> {
  let pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastDelivery = Number.NEGATIVE_INFINITY

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.length === 0) return
    const items = pending
    pending = []
    lastDelivery = Date.now()
    deliver(items)
  }

  return {
    flush,
    add: (item) => {
      pending.push(item)
      if (timer !== null) return
      const wait = lastDelivery + intervalMs - Date.now()
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    },
  }
}
