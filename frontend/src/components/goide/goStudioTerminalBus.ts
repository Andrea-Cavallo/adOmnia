import { subscribeGoIDEEvents, type GoIDETerminalOutput } from '@/lib/goide-api'

/** Cronologia conservata per terminale: basta a ridisegnare la vista dopo un cambio di progetto. */
const MAX_HISTORY_CHARS = 512 * 1024

type Listener = (data: string) => void

interface TerminalChannel {
  history: string[]
  size: number
  exited: boolean
  listeners: Set<Listener>
  exitListeners: Set<() => void>
}

const channels = new Map<string, TerminalChannel>()
let subscribed = false

function channel(terminalId: string): TerminalChannel {
  let current = channels.get(terminalId)
  if (!current) {
    current = { history: [], size: 0, exited: false, listeners: new Set(), exitListeners: new Set() }
    channels.set(terminalId, current)
  }
  return current
}

function append(terminalId: string, data: string): void {
  const current = channel(terminalId)
  current.history.push(data)
  current.size += data.length
  while (current.size > MAX_HISTORY_CHARS && current.history.length > 1) {
    current.size -= current.history.shift()!.length
  }
  for (const listener of current.listeners) listener(data)
}

function markExited(terminalId: string): void {
  const current = channel(terminalId)
  current.exited = true
  for (const listener of current.exitListeners) listener()
}

/** Iscrizione unica agli eventi terminale: l'output arriva anche prima che la vista xterm sia montata. */
export function startGoStudioTerminalBus(): void {
  if (subscribed) return
  subscribed = true
  subscribeGoIDEEvents((event) => {
    if (!event.resourceId) return
    if (event.type === 'terminal.output') {
      const payload = event.payload as GoIDETerminalOutput | undefined
      if (payload?.data) append(event.resourceId, payload.data)
    } else if (event.type === 'terminal.exited') {
      markExited(event.resourceId)
    }
  })
}

/** Collega una vista: riceve prima la cronologia già arrivata, poi l'output nuovo. */
export function attachTerminal(terminalId: string, onData: Listener, onExit: () => void): () => void {
  const current = channel(terminalId)
  if (current.history.length) onData(current.history.join(''))
  if (current.exited) onExit()
  current.listeners.add(onData)
  current.exitListeners.add(onExit)
  return () => {
    current.listeners.delete(onData)
    current.exitListeners.delete(onExit)
  }
}

/** Dimentica un terminale chiuso esplicitamente dall'utente. */
export function forgetTerminal(terminalId: string): void {
  channels.delete(terminalId)
}

/** Solo per i test: simula gli eventi del backend. */
export const terminalBusForTests = { append, markExited, reset: () => channels.clear() }
