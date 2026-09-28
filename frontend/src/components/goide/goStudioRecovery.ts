import { forgetGoIDEBuffer, rememberGoIDEBuffer } from '@/lib/goide-api'

const REMEMBER_DELAY_MS = 1500

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function key(sessionId: string, relativePath: string): string {
  return `${sessionId}\u0000${relativePath}`
}

/**
 * scheduleBufferRecovery salva il buffer non salvato dopo una pausa nella
 * digitazione. Il debounce evita di scrivere sul disco a ogni tasto premuto e
 * di trasformare la battitura in traffico IPC.
 */
export function scheduleBufferRecovery(sessionId: string, relativePath: string, content: string, diskToken: string): void {
  const id = key(sessionId, relativePath)
  const pending = timers.get(id)
  if (pending) clearTimeout(pending)
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    void rememberGoIDEBuffer(sessionId, relativePath, content, diskToken).catch(() => undefined)
  }, REMEMBER_DELAY_MS))
}

/**
 * cancelBufferRecovery annulla il salvataggio in attesa e scarta la copia di
 * recupero: si usa dopo un salvataggio riuscito o alla chiusura del documento.
 */
export function cancelBufferRecovery(sessionId: string, relativePath: string): void {
  const id = key(sessionId, relativePath)
  const pending = timers.get(id)
  if (pending) {
    clearTimeout(pending)
    timers.delete(id)
  }
  void forgetGoIDEBuffer(sessionId, relativePath).catch(() => undefined)
}

/** flushBufferRecovery scrive subito i buffer ancora in attesa di debounce. */
export function flushBufferRecovery(): void {
  for (const [, pending] of timers) clearTimeout(pending)
  timers.clear()
}
