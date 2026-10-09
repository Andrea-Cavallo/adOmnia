import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { KeyRound, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort } from '@/lib/useServerPort'
import {
  listForwards,
  listResources,
  stopForward,
  type KubeForward,
  type KubeResourceKind,
  type KubeResourceKinds,
} from '@/lib/kube-api'
import { ForwardForm } from './PodTools'

const TH = 'px-3 py-1.5 font-medium uppercase tracking-wider'
const TD = 'px-3 py-1.5 font-mono'

function labels(map: Record<string, string>): string {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join(', ')
}

function Table({ head, empty, busy, children }: { head: string[]; empty: string; busy: boolean; children: ReactNode[] }) {
  return (
    <table className="w-full text-left text-[11px]">
      <thead className="sticky top-0 bg-surface-1 text-text-4">
        <tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {children.length === 0 && (
          <tr><td colSpan={head.length} className="px-3 py-6 text-center italic text-text-4">{busy ? 'Loading…' : empty}</td></tr>
        )}
        {children}
      </tbody>
    </table>
  )
}

function rowClass(selected: boolean): string {
  return cn('cursor-pointer border-b border-border-1/50 align-top', selected ? 'bg-accent/10' : 'hover:bg-surface-2')
}

/** Lists one resource kind in the namespace, reloading when `reloadKey` changes. */
function useResources<K extends KubeResourceKind>(kind: K, context: string, namespace: string, reloadKey: number) {
  const port = useServerPort()
  const [items, setItems] = useState<KubeResourceKinds[K][]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!port || !context || !namespace) { setItems([]); return }
    let cancelled = false
    setBusy(true)
    void listResources(port, context, namespace, kind).then((result) => {
      if (cancelled) return
      setItems(result.items)
      setError(result.error)
      setBusy(false)
    })
    return () => { cancelled = true }
  }, [port, context, namespace, kind, reloadKey])
  return { items, error, busy }
}

interface ViewProps {
  context: string
  namespace: string
  reloadKey: number
  onForwardStarted: () => void
}

function ErrorBar({ error }: { error: string }) {
  return error ? <div className="border-b border-border-1 bg-error/5 px-3 py-1.5 text-[11px] text-error">{error}</div> : null
}

function Inspector({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-auto border-l border-border-1 bg-surface-1">
      <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1" title={title}>{title}</span>
        <button onClick={onClose} className="h-6 rounded px-1.5 text-[10px] text-text-4 hover:bg-surface-2 hover:text-text-1">Close</button>
      </div>
      {children}
    </aside>
  )
}

export function DeploymentsView({ context, namespace, reloadKey }: ViewProps) {
  const { items, error, busy } = useResources('deployments', context, namespace, reloadKey)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorBar error={error} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table head={['Deployment', 'Ready', 'Up-to-date', 'Available', 'Age', 'Images']} empty="No deployments in this namespace." busy={busy}>
          {items.map((d) => {
            const [ready, desired] = d.ready.split('/')
            return (
              <tr key={d.name} className="border-b border-border-1/50">
                <td className={cn(TD, 'text-text-1')} title={labels(d.selector)}>{d.name}</td>
                <td className={cn(TD, ready === desired ? 'text-success' : 'text-warning')}>{d.ready}</td>
                <td className={cn(TD, 'text-text-2')}>{d.upToDate}</td>
                <td className={cn(TD, 'text-text-2')}>{d.available}</td>
                <td className={cn(TD, 'text-text-3')}>{d.age}</td>
                <td className={cn(TD, 'break-all text-text-3')}>{d.images.join(', ')}</td>
              </tr>
            )
          })}
        </Table>
      </div>
    </div>
  )
}

export function ServicesView({ context, namespace, reloadKey, onForwardStarted }: ViewProps) {
  const { items, error, busy } = useResources('services', context, namespace, reloadKey)
  const [selected, setSelected] = useState('')
  const service = items.find((s) => s.name === selected)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ErrorBar error={error} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table head={['Service', 'Type', 'Cluster IP', 'External', 'Ports', 'Age']} empty="No services in this namespace." busy={busy}>
            {items.map((s) => (
              <tr key={s.name} role="button" tabIndex={0} aria-pressed={s.name === selected} onClick={() => setSelected(s.name)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(s.name) } }} className={rowClass(s.name === selected)}>
                <td className={cn(TD, 'text-text-1')}>{s.name}</td>
                <td className={cn(TD, 'text-text-2')}>{s.type}</td>
                <td className={cn(TD, 'text-text-3')}>{s.clusterIP}</td>
                <td className={cn(TD, 'text-text-3')}>{s.external || '—'}</td>
                <td className={cn(TD, 'text-text-2')}>{s.ports.map((p) => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol || 'TCP'}`).join(', ')}</td>
                <td className={cn(TD, 'text-text-3')}>{s.age}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
      {service && (
        <Inspector title={`svc/${service.name}`} onClose={() => setSelected('')}>
          <div className="border-b border-border-1 px-3 py-2 text-[10px] text-text-3">
            <div className="mb-1 uppercase tracking-wider text-text-4">Selector</div>
            <div className="break-all font-mono">{labels(service.selector) || 'none (external endpoints)'}</div>
            <div className="mb-1 mt-2 uppercase tracking-wider text-text-4">Ports</div>
            {service.ports.map((p) => (
              <div key={`${p.port}-${p.protocol}`} className="font-mono">{p.name || '—'} · {p.port} → {p.targetPort}</div>
            ))}
          </div>
          <ForwardForm key={service.name} context={context} namespace={namespace} target={`svc/${service.name}`} defaultRemote={service.ports[0]?.port} onStarted={onForwardStarted} />
        </Inspector>
      )}
    </div>
  )
}

export function ConfigMapsView({ context, namespace, reloadKey }: ViewProps) {
  const { items, error, busy } = useResources('configmaps', context, namespace, reloadKey)
  const [selected, setSelected] = useState('')
  const map = items.find((m) => m.name === selected)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ErrorBar error={error} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table head={['ConfigMap', 'Keys', 'Age']} empty="No config maps in this namespace." busy={busy}>
            {items.map((m) => (
              <tr key={m.name} role="button" tabIndex={0} aria-pressed={m.name === selected} onClick={() => setSelected(m.name)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(m.name) } }} className={rowClass(m.name === selected)}>
                <td className={cn(TD, 'text-text-1')}>{m.name}</td>
                <td className={cn(TD, 'text-text-2')}>{Object.keys(m.data).length}</td>
                <td className={cn(TD, 'text-text-3')}>{m.age}</td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
      {map && (
        <Inspector title={map.name} onClose={() => setSelected('')}>
          {Object.entries(map.data).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => (
            <div key={key} className="border-b border-border-1/50 px-3 py-2">
              <div className="mb-1 font-mono text-[10px] text-accent-light">{key}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-text-2">{value}</pre>
            </div>
          ))}
          {Object.keys(map.data).length === 0 && <p className="px-3 py-3 text-[10px] italic text-text-4">Empty config map.</p>}
        </Inspector>
      )}
    </div>
  )
}

export function SecretsView({ context, namespace, reloadKey }: ViewProps) {
  const { items, error, busy } = useResources('secrets', context, namespace, reloadKey)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ErrorBar error={error} />
      <div className="flex items-center gap-1.5 border-b border-border-1 px-3 py-1.5 text-[10px] text-text-4">
        <KeyRound size={11} /> Metadata only: key names and sizes. Secret values never leave the backend.
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table head={['Secret', 'Type', 'Keys', 'Age']} empty="No secrets in this namespace." busy={busy}>
          {items.map((s) => (
            <tr key={s.name} className="border-b border-border-1/50 align-top">
              <td className={cn(TD, 'text-text-1')}>{s.name}</td>
              <td className={cn(TD, 'text-text-3')}>{s.type}</td>
              <td className={cn(TD, 'text-text-2')}>{s.keys.map((k) => `${k.name} (${k.bytes} B)`).join(', ') || '—'}</td>
              <td className={cn(TD, 'text-text-3')}>{s.age}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  )
}

const FORWARD_POLL_MS = 2000

/** Every running port forward, across contexts; polled while visible. */
export function ForwardsView({ reloadKey }: { reloadKey: number }) {
  const port = useServerPort()
  const [forwards, setForwards] = useState<KubeForward[]>([])
  const refresh = useCallback(async () => setForwards(await listForwards(port)), [port])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, FORWARD_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh, reloadKey])

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table head={['Local', 'Target', 'Namespace', 'Context', 'Status', '']} empty="No port forwards. Start one from a pod or a service." busy={false}>
        {forwards.map((f) => (
          <tr key={f.id} className="border-b border-border-1/50">
            <td className={cn(TD, 'text-accent-light')}>127.0.0.1:{f.localPort}</td>
            <td className={cn(TD, 'text-text-1')}>{f.target}:{f.remotePort}</td>
            <td className={cn(TD, 'text-text-3')}>{f.namespace}</td>
            <td className={cn(TD, 'text-text-3')}>{f.context || 'current'}</td>
            <td className={cn(TD, 'max-w-[280px] truncate', f.running ? 'text-success' : 'text-text-4')} title={f.status}>{f.running ? '● ' : ''}{f.status}</td>
            <td className="px-3 py-1.5 text-right">
              <button onClick={() => void stopForward(port, f.id).then(refresh)} className="inline-flex h-6 items-center gap-1 rounded border border-border-2 px-1.5 text-[10px] text-text-2 hover:text-text-1" title={f.running ? 'Stop this forward' : 'Remove'}>
                <Square size={9} /> {f.running ? 'Stop' : 'Remove'}
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
