import { useState } from 'react'
import { Pause, Play, Radio, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { safeSelectFolder } from '@/lib/fileUtils'
import type { LiveSourceKind } from '@/lib/logstream-api'
import type { LiveSourcesApi } from './useLiveSources'

const KINDS: { id: LiveSourceKind; label: string; tool?: string }[] = [
  { id: 'file', label: 'Local file' },
  { id: 'kubectl', label: 'kubectl logs', tool: 'kubectl' },
  { id: 'oc', label: 'oc logs', tool: 'oc' },
  { id: 'docker', label: 'docker logs', tool: 'docker' },
]

const FIELD = 'h-6 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[10px] text-text-2 outline-none focus:border-accent/50'

export function LiveSourcePanel({ live, onClose }: { live: LiveSourcesApi; onClose: () => void }) {
  const [kind, setKind] = useState<LiveSourceKind>('file')
  const [path, setPath] = useState('')
  const [context, setContext] = useState('')
  const [namespace, setNamespace] = useState('')
  const [pod, setPod] = useState('')
  const [container, setContainer] = useState('')
  const [since, setSince] = useState('300')
  const [fromStart, setFromStart] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const selected = KINDS.find((item) => item.id === kind)
  const toolMissing = Boolean(selected?.tool && live.tools[selected.tool] === false)

  const pickFile = async () => {
    try {
      // The folder picker returns a directory; the file name completes the path.
      const folder = await safeSelectFolder('Select the folder that contains the log file')
      if (folder) setPath(folder.endsWith('/') || folder.endsWith('\\') ? folder : `${folder}\\`)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not open the folder picker')
    }
  }

  const startSource = async () => {
    setBusy(true)
    setError('')
    const message = await live.start({
      kind,
      path: path.trim(),
      context: context.trim(),
      namespace: namespace.trim(),
      pod: pod.trim(),
      container: container.trim(),
      sinceSeconds: Number(since) || 0,
      fromStart,
    })
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <div className="absolute inset-x-4 top-4 z-40 flex max-h-[70%] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_18px_60px_rgba(0,0,0,.65)]">
      <header className="flex items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <Radio size={12} className="text-accent" />
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-text-2">Live acquisition</p>
        <button onClick={onClose} title="Close" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-error"><X size={12} /></button>
      </header>

      <div className="shrink-0 border-b border-border-1 px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {KINDS.map((item) => {
            const missing = Boolean(item.tool && live.tools[item.tool] === false)
            return (
              <button
                key={item.id}
                onClick={() => setKind(item.id)}
                title={missing ? `${item.tool} is not installed or not on PATH` : undefined}
                className={cn(
                  'h-6 rounded border px-2 text-[10px]',
                  kind === item.id ? 'border-accent/50 bg-accent/15 text-accent-light' : 'border-border-2 text-text-3 hover:text-text-1',
                  missing && 'opacity-50',
                )}
              >
                {item.label}{missing ? ' · missing' : ''}
              </button>
            )
          })}
        </div>

        {kind === 'file' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="Full path of the log file" className={cn(FIELD, 'min-w-[280px] flex-1')} />
            <button onClick={() => void pickFile()} className="h-6 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:text-text-1">Folder…</button>
            <label className="flex items-center gap-1 text-[10px] text-text-3">
              <input type="checkbox" checked={fromStart} onChange={(event) => setFromStart(event.target.checked)} />
              From the beginning
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {kind !== 'docker' && (
              <>
                <input value={context} onChange={(event) => setContext(event.target.value)} placeholder="context" className={cn(FIELD, 'w-[120px]')} />
                <input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="namespace" className={cn(FIELD, 'w-[120px]')} />
                <input value={pod} onChange={(event) => setPod(event.target.value)} placeholder="pod" className={cn(FIELD, 'w-[150px]')} />
              </>
            )}
            <input value={container} onChange={(event) => setContainer(event.target.value)} placeholder="container" className={cn(FIELD, 'w-[130px]')} />
            <input value={since} onChange={(event) => setSince(event.target.value)} placeholder="since (s)" className={cn(FIELD, 'w-[80px]')} title="Only lines newer than this many seconds" />
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => void startSource()}
            disabled={busy || toolMissing}
            className="flex h-6 items-center gap-1.5 rounded border border-accent/40 bg-accent/12 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40"
          >
            <Play size={10} /> Start
          </button>
          <p className="min-w-0 flex-1 truncate text-[10px] text-text-4">
            {toolMissing
              ? `${selected?.tool} is not installed or not on PATH — install it or choose another source.`
              : 'Live lines join the imported files in the same session and are correlated with them.'}
          </p>
        </div>
        {error && <p className="mt-1 text-[10px] text-error">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {live.sources.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-text-4">No live source open.</p>
        ) : live.sources.map((source) => (
          <div key={source.id} className="flex items-center gap-2 border-b border-border-1 px-3 py-1.5">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', source.running ? 'bg-success' : 'bg-text-4')} title={source.running ? 'Streaming' : 'Stopped'} />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2" title={source.label}>{source.label}</span>
            <span className="shrink-0 font-mono text-[9px] text-text-4">{source.received} lines{source.dropped ? ` · ${source.dropped} dropped` : ''}</span>
            {source.error && <span className="max-w-[220px] shrink-0 truncate text-[9px] text-error" title={source.error}>{source.error}</span>}
            <button
              onClick={() => void (source.running ? live.stop(source.id) : live.resume(source.id))}
              title={source.running ? 'Stop this source' : 'Resume from where it stopped'}
              className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"
            >
              {source.running ? <Pause size={10} /> : <Play size={10} />}
            </button>
            <button
              onClick={() => void live.close(source.id)}
              title="Close this source and stop its process"
              className="grid h-6 w-6 shrink-0 place-items-center rounded border border-border-2 text-text-4 hover:text-error"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
