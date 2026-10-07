import { subscribeGoIDEEvents, type GoIDETerminalOutput } from '@/lib/goide-api'

/** Cronologia conservata per terminale: basta a ridisegnare la vista dopo un cambio di progetto. */
const MAX_HISTORY_CHARS = 512 * 1024

type Listener = (data: string) => void

interface TerminalChannel {
  history: string[]
  sequences: number[]
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
    current = { history: [], sequences: [], size: 0, exited: false, listeners: new Set(), exitListeners: new Set() }
    channels.set(terminalId, current)
  }
  return current
}

function append(terminalId: string, data: string, sequence = 0): void {
  const current = channel(terminalId)
  current.history.push(data)
  current.sequences.push(sequence)
  current.size += data.length
  while (current.size > MAX_HISTORY_CHARS && current.history.length > 1) {
    current.size -= current.history.shift()!.length
    current.sequences.shift()
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
      if (payload?.data) append(event.resourceId, payload.data, event.sequence)
    } else if (event.type === 'terminal.exited') {
      markExited(event.resourceId)
    }
  })
}

/** Bootstrap a new native view without replaying events already in its history. */
export function exportTerminalHistory(ids?: string[]) {
  return Object.fromEntries([...channels].filter(([id]) => !ids || ids.includes(id)).map(([id, value]) => [id, { history: value.history, sequences: value.sequences, exited: value.exited }]))
}
export function importTerminalHistory(value: unknown) {
  if (!value || typeof value !== 'object') return
  for (const [id, raw] of Object.entries(value)) {
    const saved = raw as { history: string[]; sequences: number[]; exited: boolean }
    if (!Array.isArray(saved.history) || !Array.isArray(saved.sequences)) continue
    const current = channel(id)
    const checkpoint = saved.sequences.reduce((last, sequence) => Math.max(last, sequence), 0)
    const tail = current.history.flatMap((data, index) => current.sequences[index] > checkpoint ? [{ data, sequence: current.sequences[index] }] : [])
    current.history = [...saved.history, ...tail.map((item) => item.data)]
    current.sequences = [...saved.sequences, ...tail.map((item) => item.sequence)]
    current.size = current.history.reduce((size, data) => size + data.length, 0)
    while (current.size > MAX_HISTORY_CHARS && current.history.length > 1) {
      current.size -= current.history.shift()!.length
      current.sequences.shift()
    }
    current.exited ||= saved.exited
  }
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
