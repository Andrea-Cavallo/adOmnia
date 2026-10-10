import { liveLogs } from '@/lib/devsession-api'
import { useDevSessionStore } from '@/stores/devSession'

const EVENT = 'adomnia:loginspector-live-session'

interface LiveSessionSource { sessionId: string; label: string }

// Sources requested before the Log Inspector mounted (Open logs sends one per workspace service).
let parked: LiveSessionSource[] = []

/** Asks the Log Inspector to stream a live session's output as a live source (parked until it mounts). */
export function streamSessionToLogInspector(sessionId: string, label: string): void {
  const source = { sessionId, label }
  parked = [...parked.filter((item) => item.sessionId !== sessionId), source]
  document.dispatchEvent(new CustomEvent(EVENT, { detail: source }))
}

/**
 * Log Inspector side: feeds `append` with the session's buffered lines, then
 * with every new line as it arrives. Returns a disposer.
 */
export function attachLiveSessionSource(append: (sourceId: string, label: string, lines: string[]) => void): () => void {
  const subscriptions = new Map<string, () => void>()
  const start = ({ sessionId, label }: LiveSessionSource) => {
    parked = parked.filter((item) => item.sessionId !== sessionId)
    if (subscriptions.has(sessionId)) return
    const sourceId = `devsession:${sessionId}`
    let lastSeq = -1
    const push = (entries: Array<{ seq: number; text: string }>) => {
      const fresh = entries.filter((entry) => entry.seq > lastSeq)
      if (!fresh.length) return
      lastSeq = fresh[fresh.length - 1].seq
      append(sourceId, label, fresh.map((entry) => entry.text))
    }
    void liveLogs(sessionId, '', 5000).then((entries) => push(entries ?? [])).catch(() => undefined)
    const unsubscribe = useDevSessionStore.subscribe((state, previous) => {
      const log = state.logs[sessionId]
      if (log && log !== previous.logs[sessionId]) push(log)
    })
    subscriptions.set(sessionId, unsubscribe)
  }
  const listener = (event: Event) => start((event as CustomEvent<LiveSessionSource>).detail)
  document.addEventListener(EVENT, listener)
  parked.forEach(start)
  return () => {
    document.removeEventListener(EVENT, listener)
    subscriptions.forEach((unsubscribe) => unsubscribe())
  }
}
