import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { listGoIDEProcesses, type GoIDEProcessInfo } from '@/lib/goide-debug-api'
import { useGoIDEDebugStore } from '@/stores/goideDebug'

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
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useModalFocusTrap(!!mode, onClose, dialogRef)
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={mode === 'attach' ? 'Attach to Process' : 'Connect to Remote Delve'} tabIndex={-1} className="w-[min(640px,92vw)] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">{mode === 'attach' ? 'Attach to Process' : 'Connect to Remote Delve'}</h2>
          <span className="truncate text-[10px] text-text-4">Stop detaches: the program keeps running.</span>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        {mode === 'attach' ? (
          <div className="p-3">
            <div className="mb-2 flex items-center gap-2">
              <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Filter by name, command or PID" aria-label="Filter processes" className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
              <button type="button" onClick={load} title="Refresh" aria-label="Refresh processes" className="grid h-8 w-8 place-items-center rounded border border-border-1 text-text-3 hover:bg-surface-2">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
            </div>
            {error && <p role="alert" className="mb-2 text-[10px] text-danger">{error}</p>}
            <div role="listbox" aria-label="Processes" className="max-h-[45vh] overflow-auto rounded border border-border-1 bg-surface-0 py-0.5">
              {!loading && visible.length === 0 && <p className="px-2 py-3 text-[11px] text-text-4">No matching process.</p>}
              {visible.map((process, index) => (
                <div key={process.pid} role="option" tabIndex={-1} aria-selected={index === selected} onClick={() => attach(process)} onMouseEnter={() => setSelected(index)}
                  className={`flex h-7 cursor-pointer items-center gap-2 px-2 font-mono text-[11px] ${index === selected ? 'bg-accent/15 text-text-1' : 'text-text-2'}`}>
                  <span className="w-16 shrink-0 text-right text-text-4">{process.pid}</span>
                  <span className="w-40 shrink-0 truncate">{process.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{process.command}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-text-4">Tip: build with -gcflags=all=-N -l for accurate variables. On Linux attaching may require ptrace permissions.</p>
          </div>
        ) : (
          <form className="space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); connect() }}>
            <label className="block text-[10px] font-medium text-text-3">Delve server address (host:port)
              <input ref={inputRef} value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" />
            </label>
            <p className="font-mono text-[10px] leading-4 text-text-4">Start it with: dlv debug --headless --listen=:2345 --accept-multiclient --api-version=2<br />Breakpoints map to this project when the sources have the same paths on both sides.</p>
            <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="submit" className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white">Connect</button></div>
          </form>
        )}
      </div>
    </div>
  )
}
