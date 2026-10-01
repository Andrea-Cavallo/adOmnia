import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertCircle, Bug, Loader2, Network, RefreshCw } from 'lucide-react'
import { listGoIDEProcesses, type GoIDEProcessInfo } from '@/lib/goide-debug-api'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

export type GoStudioAttachMode = 'attach' | 'remote'

interface GoStudioAttachDialogProps {
  sessionId: string
  mode: GoStudioAttachMode | null
  onClose: () => void
}

const DEFAULT_REMOTE_ADDRESS = '127.0.0.1:2345'
const MAX_VISIBLE_PROCESSES = 200
const REMOTE_ADDRESS_KEY = 'adomnia.goStudio.remoteDelve'

function readRemoteAddress(): string {
  try { return localStorage.getItem(REMOTE_ADDRESS_KEY) || DEFAULT_REMOTE_ADDRESS } catch { return DEFAULT_REMOTE_ADDRESS }
}

function rememberRemoteAddress(address: string): void {
  try { localStorage.setItem(REMOTE_ADDRESS_KEY, address) } catch { /* comodità per il prossimo avvio */ }
}

/** Filtro per nome, comando o PID: i processi Go più recenti restano in cima (PID decrescente). */
export function filterProcesses(processes: GoIDEProcessInfo[], query: string): GoIDEProcessInfo[] {
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? processes.filter((process) => String(process.pid) === needle || process.name.toLowerCase().includes(needle) || (process.command ?? '').toLowerCase().includes(needle))
    : processes
  return matches.slice(0, MAX_VISIBLE_PROCESSES)
}

/** Run → Attach to Process… e Connect to Remote Delve…: Stop si stacca senza terminare il programma. */
export function GoStudioAttachDialog({ sessionId, mode, onClose }: GoStudioAttachDialogProps) {
  const [processes, setProcesses] = useState<GoIDEProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [address, setAddress] = useState(DEFAULT_REMOTE_ADDRESS)
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => filterProcesses(processes, query), [processes, query])

  const load = () => {
    setLoading(true)
    setError(null)
    listGoIDEProcesses()
      .then((result) => setProcesses(result))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!mode) return
    setQuery('')
    setSelected(0)
    setAddress(readRemoteAddress())
    if (mode === 'attach') load()
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [mode])
  useEffect(() => { setSelected(0) }, [query])

  if (!mode) return null

  const attach = (process: GoIDEProcessInfo | undefined) => {
    if (!process) return
    onClose()
    void useGoIDEDebugStore.getState().start({ sessionId, mode: 'attach', processId: process.pid, workingDirectory: '', target: '' })
  }
  const connect = () => {
    if (!address.trim()) return
    rememberRemoteAddress(address.trim())
    onClose()
    void useGoIDEDebugStore.getState().start({ sessionId, mode: 'remote', address: address.trim(), workingDirectory: '', target: '' })
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, visible.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); attach(visible[selected]) }
  }

  const attachMode = mode === 'attach'
  return (
    <GoStudioModal
      open={!!mode}
      onClose={onClose}
      top
      size="lg"
      icon={attachMode ? Bug : Network}
      title={attachMode ? 'Attach to process' : 'Connect to remote Delve'}
      subtitle="Stop detaches the debugger: the program keeps running."
      footerStart={attachMode ? <><span className="gs-kbd">↑↓</span> move <span className="gs-kbd">Enter</span> attach</> : undefined}
      footer={attachMode ? undefined : <>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" type="submit" form="go-studio-remote-form">Connect</GoStudioButton>
      </>}
    >
      {attachMode ? <>
        <div className="flex items-center gap-2">
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Filter by name, command or PID" aria-label="Filter processes" className="gs-input flex-1" />
          <GoStudioButton variant="secondary" className="gs-btn-icon" onClick={load} title="Refresh" aria-label="Refresh processes">{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</GoStudioButton>
        </div>
        {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
        <div role="listbox" aria-label="Processes" className="gs-list max-h-[42vh] p-1">
          {!loading && visible.length === 0 && <p className="gs-list-empty">No matching process.</p>}
          {visible.map((process, index) => (
            <div key={process.pid} role="option" tabIndex={-1} aria-selected={index === selected} onClick={() => attach(process)} onMouseEnter={() => setSelected(index)}
              className={`flex h-8 cursor-pointer items-center gap-3 rounded-md px-2.5 ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2'}`}>
              <span className="gs-mono w-14 shrink-0 text-right text-text-4">{process.pid}</span>
              <span className="w-40 shrink-0 truncate font-medium">{process.name}</span>
              <span className="gs-mono min-w-0 flex-1 truncate text-[11px] text-text-4">{process.command}</span>
            </div>
          ))}
        </div>
        <p className="gs-hint">Build with <code className="gs-mono">-gcflags=all=-N -l</code> for accurate variables. On Linux, attaching may need ptrace permissions.</p>
      </> : (
        <form id="go-studio-remote-form" className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); connect() }}>
          <GoStudioField label="Delve server address (host:port)">
            <input ref={inputRef} value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} className="gs-input gs-mono" />
          </GoStudioField>
          <div className="gs-surface px-3 py-2.5">
            <span className="gs-section-title">Start Delve with</span>
            <code className="gs-mono mt-1 block break-all text-text-2">dlv debug --headless --listen=:2345 --accept-multiclient --api-version=2</code>
          </div>
          <p className="gs-hint">Breakpoints map to this project when the sources have the same paths on both machines.</p>
        </form>
      )}
    </GoStudioModal>
  )
}
