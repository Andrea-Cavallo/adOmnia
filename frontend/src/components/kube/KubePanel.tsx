import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, RefreshCw, Square, X, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useServerPort } from '@/lib/useServerPort'
import {
  kubeAvailable,
  listContexts,
  listNamespaces,
  listPods,
  type KubePod,
} from '@/lib/kube-api'
import {
  closeLiveSource,
  pollLiveSource,
  startLiveSource,
  stopLiveSource,
} from '@/lib/logstream-api'
import { ConfigMapsView, DeploymentsView, ForwardsView, SecretsView, ServicesView } from './KubeResources'
import { ForwardForm, PodExec, PodFiles } from './PodTools'
import { PodGoTools } from './PodGoTools'

const POLL_MS = 1500
const MAX_LOG_LINES = 2000

const TABS = ['pods', 'deployments', 'services', 'configmaps', 'secrets', 'forwards'] as const
type Tab = typeof TABS[number]
const TAB_LABEL: Record<Tab, string> = {
  pods: 'Pods', deployments: 'Deployments', services: 'Services', configmaps: 'ConfigMaps', secrets: 'Secrets', forwards: 'Port forwards',
}
const POD_TOOLS = ['logs', 'exec', 'files', 'forward', 'go'] as const
type PodTool = typeof POD_TOOLS[number]

const SELECT = 'h-7 rounded border border-border-2 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent/50'

function phaseClass(phase: string): string {
  switch (phase) {
    case 'Running': return 'bg-success/10 text-success'
    case 'Pending': return 'bg-yellow-500/10 text-yellow-400'
    case 'Failed': return 'bg-red-500/10 text-red-400'
    case 'Succeeded': return 'bg-accent/10 text-accent-light'
    default: return 'bg-surface-2 text-text-3'
  }
}

export function KubePanel() {
  const port = useServerPort()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [contexts, setContexts] = useState<string[]>([])
  const [currentContext, setCurrentContext] = useState('')
  const [context, setContext] = useState('')
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespace, setNamespace] = useState('')
  const [pods, setPods] = useState<KubePod[]>([])
  const [selectedPod, setSelectedPod] = useState<KubePod | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('pods')
  const [podTool, setPodTool] = useState<PodTool>('logs')
  const [reloadKey, setReloadKey] = useState(0)

  const loadContexts = useCallback(async () => {
    if (!port) return
    setAvailable(await kubeAvailable(port))
    const result = await listContexts(port)
    setContexts(result.contexts)
    setCurrentContext(result.current)
    if (result.error) setError(result.error)
    const initial = result.current && result.contexts.includes(result.current) ? result.current : result.contexts[0] ?? ''
    setContext(initial)
    return initial
  }, [port])

  const loadNamespaces = useCallback(async (ctx: string) => {
    if (!port || !ctx) { setNamespaces([]); setNamespace(''); setPods([]); return }
    setBusy(true)
    const result = await listNamespaces(port, ctx)
    setNamespaces(result.namespaces)
    if (result.error) setError(result.error)
    setBusy(false)
    const initial = result.namespaces.includes('default') ? 'default' : result.namespaces[0] ?? ''
    setNamespace(initial)
    return initial
  }, [port])

  const loadPods = useCallback(async (ctx: string, ns: string) => {
    if (!port || !ctx || !ns) { setPods([]); return }
    setBusy(true)
    setError('')
    const result = await listPods(port, ctx, ns)
    setPods(result.pods)
    if (result.error) setError(result.error)
    setBusy(false)
  }, [port])

  useEffect(() => {
    void (async () => {
      const ctx = await loadContexts()
      if (ctx) {
        const ns = await loadNamespaces(ctx)
        if (ns) void loadPods(ctx, ns)
      }
    })()
  }, [loadContexts, loadNamespaces, loadPods])

  const onContextChange = async (next: string) => {
    setContext(next)
    setSelectedPod(null)
    const ns = await loadNamespaces(next)
    if (ns) void loadPods(next, ns)
  }

  const onNamespaceChange = async (next: string) => {
    setNamespace(next)
    setSelectedPod(null)
    void loadPods(context, next)
  }

  const refresh = async () => {
    setError('')
    setReloadKey((key) => key + 1)
    if (context && namespace) void loadPods(context, namespace)
    else if (context) void loadNamespaces(context)
    else void loadContexts()
  }

  if (available === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <Boxes size={22} className="text-text-4" />
        <p className="text-sm text-text-2">kubectl is not installed or not on PATH.</p>
        <p className="max-w-sm text-xs text-text-4">Install kubectl and point it at a cluster to explore contexts, namespaces, pods and logs from here.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-4">Context</label>
        <select value={context} onChange={(e) => void onContextChange(e.target.value)} className={cn(SELECT, 'min-w-[180px]')}>
          {contexts.length === 0 && <option value="">No contexts</option>}
          {contexts.map((name) => (
            <option key={name} value={name}>{name}{name === currentContext ? ' · current' : ''}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-4">Namespace</label>
        <select value={namespace} onChange={(e) => void onNamespaceChange(e.target.value)} className={cn(SELECT, 'min-w-[140px]')}>
          {namespaces.length === 0 && <option value="">No namespaces</option>}
          {namespaces.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => void refresh()} disabled={busy} className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-2 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40" title="Refresh">
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div role="tablist" className="flex items-center gap-0.5 border-b border-border-1 bg-surface-1 px-2">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn('-mb-px border-b-2 px-2.5 py-1.5 text-[11px] transition-colors', tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1')}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>

      {error && <div className="border-b border-border-1 bg-red-500/5 px-3 py-1.5 text-[11px] text-red-400">{error}</div>}

      {tab === 'deployments' && <DeploymentsView context={context} namespace={namespace} reloadKey={reloadKey} onForwardStarted={() => setTab('forwards')} />}
      {tab === 'services' && <ServicesView context={context} namespace={namespace} reloadKey={reloadKey} onForwardStarted={() => setTab('forwards')} />}
      {tab === 'configmaps' && <ConfigMapsView context={context} namespace={namespace} reloadKey={reloadKey} onForwardStarted={() => setTab('forwards')} />}
      {tab === 'secrets' && <SecretsView context={context} namespace={namespace} reloadKey={reloadKey} onForwardStarted={() => setTab('forwards')} />}
      {tab === 'forwards' && <ForwardsView reloadKey={reloadKey} />}

      {tab === 'pods' && <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-surface-1 text-text-4">
              <tr>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Pod</th>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Ready</th>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Status</th>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Restarts</th>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Age</th>
                <th className="px-3 py-1.5 font-medium uppercase tracking-wider">Node</th>
              </tr>
            </thead>
            <tbody>
              {pods.length === 0 && !busy && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-text-4 italic">No pods in this namespace.</td></tr>
              )}
              {pods.length === 0 && busy && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-text-4">Loading pods…</td></tr>
              )}
              {pods.map((pod) => (
                <tr
                  key={pod.name}
                  onClick={() => setSelectedPod(pod)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPod(pod) } }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedPod?.name === pod.name}
                  className={cn('cursor-pointer border-b border-border-1/50', selectedPod?.name === pod.name ? 'bg-accent/10' : 'hover:bg-surface-2')}
                >
                  <td className="px-3 py-1.5 font-mono text-text-1">{pod.name}</td>
                  <td className="px-3 py-1.5 font-mono text-text-2">{pod.ready}</td>
                  <td className="px-3 py-1.5"><span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', phaseClass(pod.phase))}>{pod.phase}</span></td>
                  <td className="px-3 py-1.5 font-mono text-text-2">{pod.restarts}</td>
                  <td className="px-3 py-1.5 font-mono text-text-3">{pod.age}</td>
                  <td className="px-3 py-1.5 font-mono text-text-3">{pod.node}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedPod && (
          <aside className="flex w-96 shrink-0 flex-col border-l border-border-1 bg-surface-1">
            <div className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1" title={selectedPod.name}>{selectedPod.name}</span>
              <button onClick={() => setSelectedPod(null)} className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1" title="Close"><X size={12} /></button>
            </div>
            <div role="tablist" className="flex gap-0.5 border-b border-border-1 px-2">
              {POD_TOOLS.map((id) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={podTool === id}
                  onClick={() => setPodTool(id)}
                  className={cn('-mb-px border-b-2 px-2 py-1 text-[10px] capitalize', podTool === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1')}
                >
                  {id}
                </button>
              ))}
            </div>
            {podTool === 'logs' && <PodLogs key={selectedPod.name} pod={selectedPod} context={context} namespace={namespace} />}
            {podTool === 'go' && <PodGoTools key={selectedPod.name} context={context} namespace={namespace} pod={selectedPod.name} />}
            {(podTool === 'exec' || podTool === 'files') && (
              <PodContainerTool key={selectedPod.name} pod={selectedPod} context={context} namespace={namespace} tool={podTool} />
            )}
            {podTool === 'forward' && (
              <ForwardForm key={selectedPod.name} context={context} namespace={namespace} target={`pod/${selectedPod.name}`} onStarted={() => setTab('forwards')} />
            )}
          </aside>
        )}
      </div>}
    </div>
  )
}

/** Exec and file copy share the container picker. */
function PodContainerTool({ pod, context, namespace, tool }: { pod: KubePod; context: string; namespace: string; tool: 'exec' | 'files' }) {
  const [container, setContainer] = useState(pod.containers[0] ?? '')
  const target = { context, namespace, pod: pod.name, container }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pod.containers.length > 1 && (
        <div className="flex items-center gap-1.5 border-b border-border-1 px-3 py-2">
          <label className="text-[10px] uppercase tracking-wider text-text-4">Container</label>
          <select value={container} onChange={(e) => setContainer(e.target.value)} className={cn(SELECT, 'min-w-[120px]')}>
            {pod.containers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}
      {tool === 'exec' ? <PodExec key={container} target={target} /> : <PodFiles target={target} />}
    </div>
  )
}

function PodLogs({ pod, context, namespace }: { pod: KubePod; context: string; namespace: string }) {
  const port = useServerPort()
  const [container, setContainer] = useState(pod.containers[0] ?? '')
  const [sourceId, setSourceId] = useState('')
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const cursor = useRef(-1)
  const linesRef = useRef<string[]>([])
  linesRef.current = lines
  const scrollRef = useRef<HTMLDivElement>(null)

  const stop = useCallback(async (id: string) => {
    await stopLiveSource(port, id)
    setRunning(false)
  }, [port])

  const start = async () => {
    setError('')
    setLines([])
    cursor.current = -1
    const result = await startLiveSource(port, {
      kind: 'kubectl',
      context,
      namespace,
      pod: pod.name,
      container,
      sinceSeconds: 300,
    })
    if (result.error || !result.id) {
      setError(result.error || 'Could not stream this pod.')
      return
    }
    setSourceId(result.id)
    setRunning(true)
  }

  useEffect(() => {
    if (!sourceId) return
    let cancelled = false
    const tick = async () => {
      const poll = await pollLiveSource(port, sourceId, cursor.current)
      if (cancelled) return
      cursor.current = poll.cursor
      if (poll.lines.length) {
        setLines((current) => [...current, ...poll.lines].slice(-MAX_LOG_LINES))
      }
      if (!poll.running) setRunning(false)
      if (poll.error) setError(poll.error)
    }
    const timer = window.setInterval(() => { void tick() }, POLL_MS)
    void tick()
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [port, sourceId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [lines])

  useEffect(() => () => {
    if (sourceId) void closeLiveSource(port, sourceId)
  }, [sourceId, port])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-border-1 px-3 py-2">
        <label className="text-[10px] uppercase tracking-wider text-text-4">Container</label>
        <select value={container} onChange={(e) => setContainer(e.target.value)} className={cn(SELECT, 'min-w-[120px]')}>
          {pod.containers.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className="flex-1" />
        {sourceId && running ? (
          <button onClick={() => void stop(sourceId)} className="grid h-7 w-7 place-items-center rounded border border-border-2 text-text-2 hover:text-text-1" title="Stop"><Pause size={11} /></button>
        ) : (
          <button onClick={() => void start()} disabled={!container} className="flex h-7 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 text-[10px] text-accent-light hover:bg-accent/20 disabled:opacity-40">
            <Play size={11} /> Stream
          </button>
        )}
      </div>

      {error && <p className="px-3 py-1.5 text-[10px] text-red-400">{error}</p>}

      <div ref={scrollRef} className="h-72 overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed text-text-2">
        {lines.length === 0 && !running && <p className="italic text-text-4">Stream the pod logs to inspect them here.</p>}
        {lines.map((line, index) => <div key={index} className="whitespace-pre-wrap break-all">{line}</div>)}
        {running && lines.length === 0 && <p className="italic text-text-4">Waiting for output…</p>}
      </div>

      <div className="flex items-center gap-2 border-t border-border-1 px-3 py-1.5 text-[9px] text-text-4">
        {running ? <span className="flex items-center gap-1"><Square size={8} className="text-success" /> streaming</span> : <span>idle</span>}
        <span className="ml-auto font-mono">{lines.length} lines</span>
      </div>
    </div>
  )
}
