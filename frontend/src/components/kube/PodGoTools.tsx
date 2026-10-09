import { useState } from 'react'
import { Activity, Bug, Gauge, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort } from '@/lib/useServerPort'
import { openReadyForward } from '@/lib/kube-api'
import { routeToModule } from '@/lib/moduleRouting'
import { GO_REMOTE_EVENT, type GoRemoteRequest } from '@/lib/goide/goStudioRemote'

const INPUT = 'h-7 w-20 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent/50'
const BUTTON = 'flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40'
const PROFILES = { profile: 'CPU', heap: 'Heap', goroutine: 'Goroutines', allocs: 'Allocations', block: 'Block', mutex: 'Mutex' } as const

type Busy = 'debug' | 'profile' | 'trace' | null

/**
 * Go service in a pod: forwards Delve or pprof to a free 127.0.0.1 port and hands it to Go Studio,
 * which debugs, profiles or traces it against the source of the open project.
 */
export function PodGoTools({ context, namespace, pod }: { context: string; namespace: string; pod: string }) {
  const port = useServerPort()
  const [delvePort, setDelvePort] = useState('2345')
  const [pprofPort, setPprofPort] = useState('6060')
  const [profileKind, setProfileKind] = useState<keyof typeof PROFILES>('profile')
  const [seconds, setSeconds] = useState('10')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (action: Exclude<Busy, null>) => {
    setBusy(action)
    setError('')
    setNotice('')
    try {
      const remotePort = Number(action === 'debug' ? delvePort : pprofPort)
      const forward = await openReadyForward(port, { context, namespace, target: `pod/${pod}`, remotePort })
      const address = `127.0.0.1:${forward.localPort}`
      const label = `pod/${pod}`
      const request: GoRemoteRequest = action === 'debug'
        ? { action, address, label }
        : action === 'trace'
          ? { action, url: `http://${address}`, seconds: Math.min(30, Number(seconds) || 5), label }
          : { action, url: `http://${address}`, kind: profileKind, seconds: Number(seconds) || 10, label }
      routeToModule('goide', { kind: 'dispatch', eventName: GO_REMOTE_EVENT, detail: request }, {
        onTimeout: () => setError('Go Studio did not answer: open the service project there and try again.'),
      })
      setNotice(`Forwarded ${address} → ${remotePort}. It stays open in Port forwards; stop it there when done.`)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-[11px] text-text-2">
      <section className="flex flex-col gap-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-text-4">Debug with Delve</h4>
        <div className="flex items-end gap-1.5">
          <label className="flex flex-col gap-1 text-[10px] text-text-4">Delve port
            <input value={delvePort} onChange={(e) => setDelvePort(e.target.value.replace(/\D/g, ''))} className={INPUT} inputMode="numeric" />
          </label>
          <button onClick={() => void run('debug')} disabled={busy !== null || !delvePort} className={BUTTON}>
            {busy === 'debug' ? <Loader2 size={11} className="animate-spin" /> : <Bug size={11} />} Debug in Go Studio
          </button>
        </div>
        <p className="text-[10px] text-text-4">The container runs <span className="font-mono">dlv exec --headless --listen=:{delvePort || '2345'} --accept-multiclient ./app</span>. Stop detaches and leaves the pod running.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-[10px] uppercase tracking-wider text-text-4">Profile and trace (net/http/pprof)</h4>
        <div className="flex flex-wrap items-end gap-1.5">
          <label className="flex flex-col gap-1 text-[10px] text-text-4">pprof port
            <input value={pprofPort} onChange={(e) => setPprofPort(e.target.value.replace(/\D/g, ''))} className={INPUT} inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-4">Seconds
            <input value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, ''))} className={cn(INPUT, 'w-14')} inputMode="numeric" />
          </label>
          <select value={profileKind} onChange={(e) => setProfileKind(e.target.value as keyof typeof PROFILES)} className={cn(INPUT, 'w-28 font-sans')} aria-label="Profile type">
            {Object.entries(PROFILES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => void run('profile')} disabled={busy !== null || !pprofPort} className={BUTTON}>
            {busy === 'profile' ? <Loader2 size={11} className="animate-spin" /> : <Gauge size={11} />} Capture profile
          </button>
          <button onClick={() => void run('trace')} disabled={busy !== null || !pprofPort} className={BUTTON} title="Execution trace, at most 30 seconds">
            {busy === 'trace' ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />} Capture trace
          </button>
        </div>
        <p className="text-[10px] text-text-4">Saved in the open Go Studio project and shown in Profile or Trace. Seconds apply to CPU and trace.</p>
      </section>

      {error && <p className="break-words text-[10px] text-error">{error}</p>}
      {notice && <p className="break-words text-[10px] text-success">{notice}</p>}
    </div>
  )
}
