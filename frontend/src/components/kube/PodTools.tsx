import { useRef, useState, type FormEvent } from 'react'
import { Download, Loader2, Play, Upload, ArrowRightLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort } from '@/lib/useServerPort'
import { SaveBinaryFileBase64 } from '../../../bindings/adomnia/app'
import { execInPod, readPodFile, startForward, writePodFile, type KubePodTarget } from '@/lib/kube-api'

const INPUT = 'h-7 min-w-0 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent/50'
const BUTTON = 'flex h-7 shrink-0 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40'
const HISTORY = 20

/** One-shot commands in the selected container, with a short history. */
export function PodExec({ target }: { target: KubePodTarget }) {
  const port = useServerPort()
  const [command, setCommand] = useState('')
  const [runs, setRuns] = useState<{ command: string; output: string; error: string; truncated: boolean }[]>([])
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const cmd = command.trim()
    if (!cmd || busy) return
    setBusy(true)
    const result = await execInPod(port, target, cmd)
    setRuns((current) => [{ command: cmd, ...result }, ...current].slice(0, HISTORY))
    setCommand('')
    setBusy(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={(e) => void submit(e)} className="flex items-center gap-1.5 border-b border-border-1 px-3 py-2">
        <span className="font-mono text-[11px] text-text-4">$</span>
        <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="env | sort" className={cn(INPUT, 'flex-1')} aria-label="Command" />
        <button type="submit" disabled={busy || !command.trim()} className={BUTTON} title="Run with sh -c in the container">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run
        </button>
      </form>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed">
        {runs.length === 0 && <p className="italic text-text-4">Runs one command through <code>sh -c</code> — no TTY, 60 s limit.</p>}
        {runs.map((run, index) => (
          <div key={runs.length - index} className="mb-3">
            <div className="text-accent-light">$ {run.command}</div>
            {run.truncated && <div className="text-text-4">… output truncated to the last 1 MB</div>}
            {run.output && <pre className="whitespace-pre-wrap break-all text-text-2">{run.output}</pre>}
            {run.error && <pre className="whitespace-pre-wrap break-all text-error">{run.error}</pre>}
          </div>
        ))}
      </div>
    </div>
  )
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** Copies single files between this machine and the container (16 MB max). */
export function PodFiles({ target }: { target: KubePodTarget }) {
  const port = useServerPort()
  const [path, setPath] = useState('/')
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const download = async () => {
    setBusy(true)
    setStatus(null)
    const result = await readPodFile(port, target, path)
    if (result.error) {
      setStatus({ tone: 'error', text: result.error })
    } else {
      try {
        const saved = await SaveBinaryFileBase64(path.split('/').pop() || 'download', result.data)
        if (saved) setStatus({ tone: 'ok', text: `Saved ${result.size} bytes to ${saved}` })
      } catch (error: unknown) {
        setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save the file' })
      }
    }
    setBusy(false)
  }

  const upload = async (file: File) => {
    const destination = path.endsWith('/') ? path + file.name : path
    setBusy(true)
    setStatus(null)
    try {
      const error = await writePodFile(port, target, destination, await readAsBase64(file))
      setStatus(error ? { tone: 'error', text: error } : { tone: 'ok', text: `Uploaded ${file.name} to ${destination}` })
    } catch (error: unknown) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not read the file' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <label className="text-[10px] uppercase tracking-wider text-text-4" htmlFor="kube-file-path">Container path</label>
      <input id="kube-file-path" value={path} onChange={(e) => setPath(e.target.value)} className={INPUT} placeholder="/app/config.yaml" />
      <div className="flex gap-1.5">
        <button onClick={() => void download()} disabled={busy || !path.trim() || path.endsWith('/')} className={BUTTON} title="Copy the file at this path to this machine">
          <Download size={11} /> Download
        </button>
        <button onClick={() => picker.current?.click()} disabled={busy || !path.trim()} className={BUTTON} title="Upload a local file to this path (a folder path keeps the file name)">
          <Upload size={11} /> Upload…
        </button>
        {busy && <Loader2 size={12} className="animate-spin self-center text-text-4" />}
        <input ref={picker} type="file" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file) }} />
      </div>
      {status && <p className={cn('break-all text-[10px]', status.tone === 'ok' ? 'text-success' : 'text-error')}>{status.text}</p>}
      <p className="text-[10px] text-text-4">Needs <code>head</code> (and <code>sh</code> + <code>cat</code> for uploads) in the container. An upload replaces the file.</p>
    </div>
  )
}

/** Starts a localhost-only port forward; running forwards live in the Forwards tab. */
export function ForwardForm({ context, namespace, target, defaultRemote, onStarted }: {
  context: string
  namespace: string
  target: string
  defaultRemote?: number
  onStarted: () => void
}) {
  const port = useServerPort()
  const [remote, setRemote] = useState(String(defaultRemote ?? 8080))
  const [local, setLocal] = useState(String(defaultRemote ?? 8080))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    setError('')
    const failure = await startForward(port, { context, namespace, target, localPort: Number(local), remotePort: Number(remote) })
    setBusy(false)
    if (failure) setError(failure)
    else onStarted()
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-end gap-1.5">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">Local
          <input value={local} onChange={(e) => setLocal(e.target.value.replace(/\D/g, ''))} className={cn(INPUT, 'w-20')} inputMode="numeric" />
        </label>
        <ArrowRightLeft size={12} className="mb-2 text-text-4" />
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-text-4">Remote
          <input value={remote} onChange={(e) => setRemote(e.target.value.replace(/\D/g, ''))} className={cn(INPUT, 'w-20')} inputMode="numeric" />
        </label>
        <button onClick={() => void start()} disabled={busy || !local || !remote} className={BUTTON}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Forward
        </button>
      </div>
      {error && <p className="break-all text-[10px] text-error">{error}</p>}
      <p className="text-[10px] text-text-4">Listens on 127.0.0.1 only. <span className="font-mono">{target}</span></p>
    </div>
  )
}
