import { forgetGoIDEBuffer, rememberGoIDEBuffer } from '@/lib/goide-api'

const REMEMBER_DELAY_MS = 1500

interface PendingRecovery {
  timer: ReturnType<typeof setTimeout>
  write: () => void
}

const pending = new Map<string, PendingRecovery>()

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
  const previous = pending.get(id)
  if (previous) clearTimeout(previous.timer)
  const write = () => {
    pending.delete(id)
    void rememberGoIDEBuffer(sessionId, relativePath, content, diskToken).catch(() => undefined)
  }
  pending.set(id, { timer: setTimeout(write, REMEMBER_DELAY_MS), write })
}

/**
 * cancelBufferRecovery annulla il salvataggio in attesa e scarta la copia di
 * recupero: si usa dopo un salvataggio riuscito o alla chiusura del documento.
 */
export function cancelBufferRecovery(sessionId: string, relativePath: string): void {
  const id = key(sessionId, relativePath)
  const previous = pending.get(id)
  if (previous) {
    clearTimeout(previous.timer)
    pending.delete(id)
  }
  void forgetGoIDEBuffer(sessionId, relativePath).catch(() => undefined)
}

/** flushBufferRecovery scrive subito i buffer ancora in attesa di debounce (chiusura finestra, cambio pannello). */
export function flushBufferRecovery(): void {
  for (const entry of [...pending.values()]) {
    clearTimeout(entry.timer)
    entry.write()
  }
}
