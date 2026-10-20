import type { GoIDEEvent } from '@/lib/code-studio-api'

/** Coalesce a server's import burst; preserve ordering across status and other events. */
export function diagnosticEventBatch(deliver: (events: GoIDEEvent[]) => void): (event: GoIDEEvent) => void {
  const pending = new Map<string, GoIDEEvent>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!pending.size) return
    const events = [...pending.values()]
    pending.clear()
    deliver(events)
  }
  return (event) => {
    if (event.type !== 'lsp.diagnostics') {
      flush()
      deliver([event])
      return
    }
    const uri = (event.payload as { uri: string }).uri
    pending.set(`${event.sessionId}\0${uri}`, event)
    if (timer === undefined) timer = setTimeout(flush, 50)
  }
}
