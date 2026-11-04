import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { RequestItem, ResponseData } from '@/lib/types'
import { sendRequestInParallel, type ParallelSendOutcome } from '@/lib/parallelSend'
import { cn } from '@/lib/utils'

/**
 * Hidden fan-out panel: no button, menu entry or palette command opens it, only
 * Ctrl+Shift+Enter in the API workspace (see useKeyboardShortcuts). It sends the
 * active request several times at once through the Go batch executor, either
 * unchanged or with one body per copy, and lists every response.
 */
export function ParallelSendPanel({ request, vars, onClose, onOpenResponse }: {
  request: RequestItem
  vars: Record<string, string>
  onClose: () => void
  onOpenResponse: (response: ResponseData) => void
}) {
  const [copies, setCopies] = useState(5)
  const [concurrency, setConcurrency] = useState(4)
  const [variants, setVariants] = useState('')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<ParallelSendOutcome | null>(null)
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (controllerRef.current) controllerRef.current.abort()
      else onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = async () => {
    const parsed = parseBodies(variants)
    if ('error' in parsed) { setError(parsed.error); return }
    setError('')
    setOutcome(null)
    setRunning(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const result = await sendRequestInParallel(request, vars, {
        copies,
        concurrency,
        bodies: parsed.bodies.length > 0 ? parsed.bodies : undefined,
        signal: controller.signal,
      })
      setOutcome(result)
      if (result.error) setError(result.error)
    } finally {
      controllerRef.current = null
      setRunning(false)
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
    setRunning(false)
  }

  const results = outcome?.results ?? []
  const sent = variants.trim() ? parseBodies(variants) : null
  const planned = sent && 'bodies' in sent && sent.bodies.length > 0 ? sent.bodies.length : copies

  return (
    <div
      role="dialog"
      aria-label="Parallel send"
      data-parallel-send
      className="fixed bottom-3 right-3 z-40 flex w-[400px] flex-col gap-2 rounded-md border border-border-1 bg-surface-1 p-3 text-xs text-text-2 shadow-xl"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-3">Parallel send</span>
        <span className="font-mono text-[10px] text-text-4">Ctrl+Shift+Enter</span>
        <button type="button" onClick={onClose} aria-label="Close parallel send" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1">
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span>Copies</span>
          <input
            type="number" min={1} max={50} value={copies} disabled={running}
            onChange={(event) => setCopies(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
            className="h-7 w-14 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span>In flight</span>
          <input
            type="number" min={1} max={64} value={concurrency} disabled={running}
            onChange={(event) => setConcurrency(Math.min(64, Math.max(1, Number(event.target.value) || 1)))}
            className="h-7 w-14 rounded border border-border-2 bg-surface-2 px-1.5 font-mono text-text-1 outline-none focus:border-accent"
          />
        </label>
        <span className="ml-auto font-mono text-[10px] text-text-4">{request.method} · {request.name || request.url}</span>
      </div>

      <textarea
        value={variants}
        disabled={running}
        onChange={(event) => setVariants(event.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="Optional: one body per copy (one JSON body per line, or a JSON array of strings)"
        aria-label="Body variants"
        className="w-full resize-y rounded border border-border-2 bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="h-7 rounded bg-accent px-3 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {running ? 'Sending…' : `Send ${planned}×`}
        </button>
        {running && (
          <button type="button" onClick={stop} className="h-7 rounded border border-border-2 px-2.5 text-text-2 hover:bg-surface-2">Cancel</button>
        )}
        {outcome && !running && (
          <span className="font-mono text-[10px] text-text-4">{outcome.ms} ms · {outcome.concurrency} in flight</span>
        )}
      </div>

      {error && <div className="rounded border border-error/30 bg-error/10 px-2 py-1 text-error">{error}</div>}

      {results.length > 0 && (
        <div className="max-h-[42vh] overflow-auto rounded border border-border-1">
          {results.map((item) => (
            <button
              key={item.index}
              type="button"
              onClick={() => onOpenResponse(item.response)}
              title="Show this response in the Response panel"
              className="flex w-full items-center gap-2 border-b border-border-1/60 px-2 py-1 text-left last:border-b-0 hover:bg-surface-2"
            >
              <span className="w-5 shrink-0 font-mono text-[10px] text-text-4">{item.index + 1}</span>
              <span className={cn('w-9 shrink-0 font-mono font-bold', statusTone(item.response))}>
                {item.response.error ? item.response.error.code : item.response.status}
              </span>
              <span className="w-14 shrink-0 font-mono text-[10px] text-text-3">{item.response.ms} ms</span>
              <span className="w-14 shrink-0 font-mono text-[10px] text-text-4">{formatSize(item.response.size)}</span>
              <span className="min-w-0 flex-1 truncate text-text-3">
                {item.response.error?.message ?? compactBody(item.response.body)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function parseBodies(raw: string): { bodies: string[] } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { bodies: [] }
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) return { error: 'The JSON array needs at least one body.' }
      return { bodies: parsed.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)) }
    } catch {
      return { error: 'The JSON array is not valid JSON.' }
    }
  }
  return { bodies: trimmed.split('\n').map((line) => line.trim()).filter(Boolean) }
}

function statusTone(response: ResponseData): string {
  if (response.error) return 'text-error'
  if (response.status >= 500) return 'text-error'
  if (response.status >= 400) return 'text-warning'
  if (response.status >= 300) return 'text-info'
  return 'text-success'
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function compactBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 120)
}
