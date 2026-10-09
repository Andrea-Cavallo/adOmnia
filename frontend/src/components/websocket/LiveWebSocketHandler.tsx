import { useEffect, useState } from 'react'
import { Bug, Code2, Loader2, Shuffle } from 'lucide-react'
import { useDevSessionStore } from '@/stores/devSession'
import { debugWebSocketHandler, openWebSocketHandler, showConnectionGoroutines, websocketHandlerFor, type WebSocketHandler } from '@/lib/devsession/websocketHandler'

/** Under the URL bar when the URL reaches a live Go service: open or debug its WebSocket handler. */
export function LiveWebSocketHandler({ url, onDebugReady, connected = false }: { url: string; onDebugReady: () => void; connected?: boolean }) {
  const sessions = useDevSessionStore((state) => state.sessions)
  const [target, setTarget] = useState<WebSocketHandler | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => { void websocketHandlerFor(url).then((next) => { if (!cancelled) setTarget(next) }).catch(() => undefined) }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [url, sessions])
  if (!target) return null
  const debug = async () => {
    setError('')
    try {
      await debugWebSocketHandler(target, setProgress)
      setProgress('')
      onDebugReady()
    } catch (err) {
      setProgress('')
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-3">
      <span>Served by <span className="font-mono text-text-1">{target.handler}()</span> in {target.session.service}{target.session.kind === 'debug' ? ' (debugging)' : ''}</span>
      <button type="button" onClick={() => void openWebSocketHandler(target)} className="inline-flex items-center gap-1 rounded border border-border-2 px-2 py-0.5 text-text-2 hover:border-accent hover:text-accent"><Code2 size={11} /> Handler</button>
      {!connected && <button type="button" onClick={() => void debug()} disabled={!!progress && progress.endsWith('…')} title="Breakpoint on the upgrade, service under Delve, then connect: the handshake stops in the handler" className="inline-flex items-center gap-1 rounded border border-warning/50 px-2 py-0.5 text-warning hover:bg-warning/10 disabled:opacity-60">
        {progress.endsWith('…') ? <Loader2 size={11} className="animate-spin" /> : <Bug size={11} />} Debug handler
      </button>}
      {connected && target.session.kind === 'debug' && (
        <button type="button" onClick={() => void showConnectionGoroutines(target).then(setProgress, (err: unknown) => setError(err instanceof Error ? err.message : String(err)))} title="Pause the service and select the goroutines running this handler in the debugger" className="inline-flex items-center gap-1 rounded border border-border-2 px-2 py-0.5 text-text-2 hover:border-accent hover:text-accent"><Shuffle size={11} /> Goroutines</button>
      )}
      {progress && <span className="text-text-4">{progress}</span>}
      {error && <span className="text-error">{error}</span>}
    </div>
  )
}
