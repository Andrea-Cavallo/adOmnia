import { useState } from 'react'
import { Download, Radio } from 'lucide-react'
import { captureGoIDELiveProfile, type GoIDESession } from '@/lib/goide-api'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

/** Endpoint di net/http/pprof: goroutine e threadcreate si ottengono solo da un processo vivo. */
const KINDS = {
  goroutine: 'Goroutines',
  heap: 'Heap (in use)',
  allocs: 'Allocations',
  profile: 'CPU',
  block: 'Block',
  mutex: 'Mutex',
  threadcreate: 'Thread creation',
} as const
type Kind = keyof typeof KINDS

const URL_KEY = 'adomnia.goStudio.livePprofUrl'

function rememberedUrl(): string {
  try { return localStorage.getItem(URL_KEY) || 'http://localhost:6060' } catch { return 'http://localhost:6060' }
}

/** Cattura un profilo da un servizio in esecuzione che importa net/http/pprof (solo localhost). */
export function GoStudioCaptureLiveProfile({ session, onCreated }: { session: GoIDESession; onCreated: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(rememberedUrl)
  const [kind, setKind] = useState<Kind>('goroutine')
  const [seconds, setSeconds] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authorized = session.project.authorization === 'tooling-permitted'

  const capture = async () => {
    setBusy(true)
    setError(null)
    try {
      const file = await captureGoIDELiveProfile({ sessionId: session.id, url, kind, seconds })
      try { localStorage.setItem(URL_KEY, url) } catch { /* preferenza locale, facoltativa */ }
      setOpen(false)
      onCreated(file.relative)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <GoStudioButton small icon={Radio} disabled={!authorized} onClick={() => setOpen(true)} title="Capture a profile from a running service that imports net/http/pprof">
        From service
      </GoStudioButton>
      <GoStudioModal open={open} onClose={() => { if (!busy) setOpen(false) }} title="Capture from a running service" icon={Radio} size="sm"
        subtitle="Download a profile from /debug/pprof of a service on this machine and save it in the project root."
        footer={<><GoStudioButton disabled={busy} onClick={() => setOpen(false)}>Cancel</GoStudioButton><GoStudioButton variant="primary" icon={Download} loading={busy} disabled={!authorized || busy} onClick={() => void capture()}>{busy && kind === 'profile' ? `Sampling CPU for ${seconds}s…` : 'Capture'}</GoStudioButton></>}>
        <div className="flex flex-col gap-4">
          <GoStudioField label="Service address" hint="Localhost only. The service must import _ &quot;net/http/pprof&quot; and serve it on this port.">
            <input className="gs-input gs-mono" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://localhost:6060" />
          </GoStudioField>
          <GoStudioField label="Profile type">
            <select className="gs-input" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              {Object.entries(KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </GoStudioField>
          {kind === 'profile' && (
            <GoStudioField label="CPU sampling (seconds)" hint="1–60 seconds of live traffic.">
              <input className="gs-input gs-mono" type="number" min={1} max={60} value={seconds} onChange={(event) => setSeconds(Math.min(60, Math.max(1, Number(event.target.value) || 10)))} />
            </GoStudioField>
          )}
          {error && <GoStudioAlert>{error}</GoStudioAlert>}
        </div>
      </GoStudioModal>
    </>
  )
}
