import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, TerminalSquare, X } from 'lucide-react'
import { GoStudioTerminalView, closeTerminal } from './GoStudioTerminalView'
import { startGoStudioTerminalBus } from './goStudioTerminalBus'
import {
  listGoIDETerminals,
  openGoIDETerminal,
  type GoIDESession,
  type GoIDETerminalSession,
} from '@/lib/goide-api'

startGoStudioTerminalBus()

interface GoStudioTerminalPanelProps {
  session: GoIDESession
  /** Alla prima apertura della scheda si avvia subito una shell, senza passare dal +. */
  visible: boolean
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Pannello dei terminali PTY della sessione. Ogni terminale ha nome, stato e
 * chiusura indipendenti; la Run console resta un pannello separato perché
 * mostra un'esecuzione controllata, non una shell interattiva.
 */
export function GoStudioTerminalPanel({ session, visible }: GoStudioTerminalPanelProps) {
  const [terminals, setTerminals] = useState<GoIDETerminalSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const autoOpened = useRef(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const authorized = session.project.authorization === 'tooling-permitted'

  useEffect(() => {
    let cancelled = false
    // Il pannello resta montato passando fra progetti: lo stato del progetto precedente non va riusato.
    setTerminals([])
    setActiveId(null)
    void listGoIDETerminals(session.id)
      .then((existing) => {
        if (cancelled) return
        setTerminals(existing)
        setActiveId((current) => (current && existing.some((item) => item.id === current) ? current : existing[0]?.id ?? null))
        setLoaded(true)
      })
      .catch((reason) => !cancelled && setError(errorText(reason)))
    return () => {
      cancelled = true
      setLoaded(false)
      autoOpened.current = false
    }
  }, [session.id])

  const open = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const opened = await openGoIDETerminal({
        sessionId: session.id,
        name: '',
        workingDirectory: '',
        columns: 80,
        rows: 24,
      })
      setTerminals((current) => [...current, opened])
      setActiveId(opened.id)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [session.id])

  useEffect(() => {
    if (!visible || !loaded || !authorized || busy || terminals.length > 0 || autoOpened.current) return
    autoOpened.current = true
    void open()
  }, [authorized, busy, loaded, open, terminals.length, visible])

  const close = useCallback(async (terminalId: string) => {
    try {
      await closeTerminal(terminalId)
    } catch (reason) {
      setError(errorText(reason))
    }
    setTerminals((current) => current.filter((item) => item.id !== terminalId))
    setActiveId((current) => {
      if (current !== terminalId) return current
      const remaining = terminals.filter((item) => item.id !== terminalId)
      return remaining[0]?.id ?? null
    })
  }, [terminals])

  const markExited = useCallback((terminalId: string) => {
    setTerminals((current) => current.map((item) => (item.id === terminalId ? { ...item, status: 'exited' } : item)))
  }, [])

  if (!authorized) {
    return (
      <section aria-label="Go Studio terminals" className="flex h-full min-h-0 flex-col items-start gap-2 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3">
          <TerminalSquare size={11} /> Terminal
        </div>
        <p className="text-[11px] leading-4 text-text-4">
          Authorize tooling for this project to open a real shell. Opening a project never starts a process on its own.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Go Studio terminals" className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-1 px-1">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`group flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] ${
              terminal.id === activeId ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2'
            }`}
          >
            <button type="button" onClick={() => setActiveId(terminal.id)} className="max-w-32 truncate">
              {terminal.name}
              {terminal.status !== 'running' && <span className="ml-1 text-text-4">({terminal.status})</span>}
            </button>
            <button
              type="button"
              onClick={() => void close(terminal.id)}
              title="Close terminal"
              className="grid h-4 w-4 place-items-center rounded text-text-4 opacity-0 hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          title="New terminal"
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"
        >
          <Plus size={12} />
        </button>
      </div>

      {error && (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[10px] text-danger">
          {error}
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 && (
          <p className="p-3 text-[10px] text-text-4">No terminal open. Use + to start a shell in the project directory.</p>
        )}
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className="absolute inset-0 p-1"
            style={{ visibility: terminal.id === activeId ? 'visible' : 'hidden' }}
          >
            <GoStudioTerminalView terminalId={terminal.id} active={terminal.id === activeId} onExit={markExited} />
          </div>
        ))}
      </div>
    </section>
  )
}
