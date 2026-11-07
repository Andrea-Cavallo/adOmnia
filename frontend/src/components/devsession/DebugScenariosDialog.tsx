import { useEffect, useState } from 'react'
import { CheckCircle2, Clapperboard, Loader2, Play, Plus, Trash2, X, XCircle } from 'lucide-react'
import { DialogBody, DialogContent, DialogHeader, DialogOverlay } from '@/components/ui/dialog'
import { diffEvidence, type DebugScenario, type ScenarioEvidence } from '@/lib/devsession/debugScenario'
import type { RequestItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useDebugScenariosStore } from '@/stores/debugScenarios'
import { useEnvironmentsStore } from '@/stores/environments'

interface Connection { id: string; name: string }

const runner = () => import('@/lib/devsession/debugScenarioRun')

/** Database Studio connections, read lazily: only the scenario dialog needs them. */
function useDbConnections(open: boolean): Connection[] {
  const [connections, setConnections] = useState<Connection[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    void (async () => {
      try {
        const [{ safeStorageGet }, { CONNECTIONS_KEY, STORAGE_BUCKET }] = await Promise.all([import('@/lib/wailsStorage'), import('@/components/database/dbShared')])
        const parsed: unknown = JSON.parse((await safeStorageGet(STORAGE_BUCKET, CONNECTIONS_KEY)) || '[]')
        const list = Array.isArray(parsed) ? parsed.filter((item): item is Connection => typeof item?.id === 'string').map((item) => ({ id: item.id, name: item.name || item.id })) : []
        if (alive) setConnections(list)
      } catch {
        if (alive) setConnections([])
      }
    })()
    return () => { alive = false }
  }, [open])
  return connections
}

const field = 'h-7 rounded border border-border-2 bg-surface-1 px-2 text-[11.5px] text-text-1 outline-none focus:border-accent'
const sectionTitle = 'mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-4'

function Evidence({ last, previous }: { last?: ScenarioEvidence; previous?: ScenarioEvidence }) {
  if (!last) return <p className="text-[11.5px] text-text-4">Not run yet. Run it once to record the baseline.</p>
  const failed = last.assertions.filter((item) => !item.passed)
  const changes = previous ? diffEvidence(previous, last) : null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-2">
        <span className={cn('font-mono font-semibold', last.status >= 400 || !last.status ? 'text-error' : 'text-success')}>{last.status || last.error || 'no response'}</span>
        <span>{last.durationMs} ms</span>
        <span>{last.assertions.length - failed.length}/{last.assertions.length} assertions</span>
        <span>{last.hits.length} breakpoint stops · {last.sql.length} SQL · {last.logs} logs{last.logErrors ? ` (${last.logErrors} errors)` : ''}</span>
        <span className="text-text-4">{new Date(last.at).toLocaleString()}</span>
      </div>
      {failed.map((item) => <p key={item.label} className="flex items-center gap-1.5 text-[11.5px] text-error"><XCircle size={12} />{item.label} · got {item.actual}</p>)}
      {changes === null && <p className="text-[11.5px] text-text-4">First run: the next one will be compared with it.</p>}
      {changes?.length === 0 && <p className="flex items-center gap-1.5 text-[11.5px] text-success"><CheckCircle2 size={12} />Same as the previous run.</p>}
      {changes && changes.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold text-warning">{changes.length} difference{changes.length === 1 ? '' : 's'} from the previous run</p>
          <ul className="space-y-0.5 font-mono text-[11px] text-text-2">{changes.map((change) => <li key={change}>{change}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function ScenarioEditor({ scenario, connections }: { scenario: DebugScenario; connections: Connection[] }) {
  const update = useDebugScenariosStore((state) => state.update)
  const remove = useDebugScenariosStore((state) => state.remove)
  const run = useDebugScenariosStore((state) => state.runs[scenario.id])
  const env = useEnvironmentsStore((state) => state.environments.find((item) => item.id === scenario.environmentId))
  const running = run?.done === false
  const patch = (next: Partial<DebugScenario>) => update(scenario.id, next)
  return (
    <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <input aria-label="Scenario name" className={cn(field, 'min-w-0 flex-1 text-[13px] font-semibold')} value={scenario.name} onChange={(event) => patch({ name: event.target.value })} />
        <button type="button" disabled={running} onClick={() => void runner().then((module) => module.runDebugScenario(scenario.id))}
          className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-60">
          {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}{running ? 'Running…' : 'Run scenario'}
        </button>
        <button type="button" title="Delete scenario" aria-label="Delete scenario" onClick={() => remove(scenario.id)} className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-error/10 hover:text-error"><Trash2 size={13} /></button>
      </div>
      <p className="truncate font-mono text-[11px] text-text-3">{scenario.request.method} {scenario.request.url} · environment {env?.name ?? 'none'} · {(scenario.request.assertions ?? []).filter((item) => item.enabled).length} assertions</p>
      {run && <p className={cn('text-[11.5px]', run.error ? 'text-error' : 'text-text-3')}>{run.error ?? run.message}</p>}

      <section>
        <h4 className={sectionTitle}>Last run</h4>
        <Evidence last={scenario.lastRun} previous={scenario.previousRun} />
      </section>

      <section>
        <h4 className={sectionTitle}>Test data (over the environment)</h4>
        {scenario.testData.map((row) => (
          <div key={row.id} className="mb-1 flex items-center gap-1.5">
            <input type="checkbox" aria-label="Enabled" checked={row.enabled} onChange={(event) => patch({ testData: scenario.testData.map((item) => (item.id === row.id ? { ...item, enabled: event.target.checked } : item)) })} />
            <input aria-label="Variable" placeholder="variable" className={cn(field, 'w-40 font-mono')} value={row.key} onChange={(event) => patch({ testData: scenario.testData.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)) })} />
            <input aria-label="Value" placeholder="value" className={cn(field, 'min-w-0 flex-1 font-mono')} value={row.value} onChange={(event) => patch({ testData: scenario.testData.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)) })} />
            <button type="button" aria-label="Remove variable" onClick={() => patch({ testData: scenario.testData.filter((item) => item.id !== row.id) })} className="text-text-4 hover:text-error"><X size={12} /></button>
          </div>
        ))}
        <button type="button" onClick={() => patch({ testData: [...scenario.testData, { id: crypto.randomUUID(), key: '', value: '', enabled: true }] })} className="flex items-center gap-1 text-[11px] text-text-3 hover:text-accent"><Plus size={11} />Add variable</button>
      </section>

      <section>
        <h4 className={sectionTitle}>Breakpoints</h4>
        {scenario.breakpoints.length === 0 && <p className="text-[11.5px] text-text-4">None: set them in Code Studio, then save the request as a new scenario.</p>}
        {scenario.breakpoints.map((breakpoint) => (
          <div key={`${breakpoint.relativePath}:${breakpoint.line}`} className="flex items-center gap-2 font-mono text-[11px] text-text-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-error" />
            <span className="min-w-0 flex-1 truncate">{breakpoint.relativePath}:{breakpoint.line}{breakpoint.condition ? ` if ${breakpoint.condition}` : ''}{breakpoint.logMessage ? ` log "${breakpoint.logMessage}"` : ''}</span>
            <button type="button" aria-label="Remove breakpoint" onClick={() => patch({ breakpoints: scenario.breakpoints.filter((item) => item !== breakpoint) })} className="text-text-4 hover:text-error"><X size={12} /></button>
          </div>
        ))}
      </section>

      <section>
        <h4 className={sectionTitle}>Check queries (run after the call, read-only)</h4>
        {scenario.queries.map((query, index) => (
          <div key={index} className="mb-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <select aria-label="Connection" className={cn(field, 'min-w-0 flex-1')} value={query.connectionId}
                onChange={(event) => patch({ queries: scenario.queries.map((item, i) => (i === index ? { ...item, connectionId: event.target.value, connectionName: connections.find((c) => c.id === event.target.value)?.name ?? '' } : item)) })}>
                <option value="">Database Studio connection…</option>
                {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
              </select>
              <button type="button" aria-label="Remove query" onClick={() => patch({ queries: scenario.queries.filter((_, i) => i !== index) })} className="text-text-4 hover:text-error"><X size={12} /></button>
            </div>
            <textarea aria-label="SQL" placeholder="SELECT * FROM orders WHERE id = 42" className={cn(field, 'h-14 w-full py-1 font-mono')} value={query.sql}
              onChange={(event) => patch({ queries: scenario.queries.map((item, i) => (i === index ? { ...item, sql: event.target.value } : item)) })} />
          </div>
        ))}
        <button type="button" onClick={() => patch({ queries: [...scenario.queries, { connectionId: connections[0]?.id ?? '', connectionName: connections[0]?.name ?? '', sql: '' }] })} className="flex items-center gap-1 text-[11px] text-text-3 hover:text-accent"><Plus size={11} />Add query</button>
      </section>
    </div>
  )
}

export function DebugScenariosDialog({ open, onClose, tabId, request }: { open: boolean; onClose: () => void; tabId: string; request: RequestItem }) {
  const scenarios = useDebugScenariosStore((state) => state.scenarios)
  const runs = useDebugScenariosStore((state) => state.runs)
  const connections = useDbConnections(open)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // This request's scenarios first: they are the ones the developer opened the dialog for.
  const ordered = [...scenarios].sort((a, b) => Number(b.request.id === request.id) - Number(a.request.id === request.id))
  const selected = ordered.find((item) => item.id === selectedId) ?? ordered[0]
  const saveCurrent = async () => {
    setSaving(true)
    try {
      const { saveScenarioFromTab } = await runner()
      const scenario = await saveScenarioFromTab(tabId, request.name)
      if (scenario) setSelectedId(scenario.id)
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogOverlay open={open} onClose={onClose}>
      <DialogContent size="xl">
        <DialogHeader className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Clapperboard size={15} className="shrink-0 text-accent" />
            <h2 className="truncate text-[13px] font-semibold text-text-1">Debug scenarios</h2>
            <span className="truncate text-[11px] text-text-4">Request, environment, test data, breakpoints, assertions and queries, replayed with one click</span>
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><X size={13} /></button>
        </DialogHeader>
        <DialogBody className="flex h-[min(70vh,560px)] p-0">
          <aside className="flex w-56 shrink-0 flex-col border-r border-border-1">
            <button type="button" disabled={saving} onClick={() => void saveCurrent()} className="m-2 flex h-7 items-center justify-center gap-1.5 rounded border border-border-2 text-[11px] font-semibold text-text-2 hover:border-accent hover:text-accent disabled:opacity-60">
              <Plus size={12} />Save this request
            </button>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {ordered.map((scenario) => {
                const changes = scenario.lastRun && scenario.previousRun ? diffEvidence(scenario.previousRun, scenario.lastRun).length : 0
                const failing = scenario.lastRun?.assertions.some((item) => !item.passed)
                return (
                  <li key={scenario.id}>
                    <button type="button" onClick={() => setSelectedId(scenario.id)}
                      className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] hover:bg-surface-2', scenario.id === selected?.id ? 'bg-accent/10 text-text-1' : 'text-text-2')}>
                      {runs[scenario.id]?.done === false ? <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
                        : <span className={cn('h-2 w-2 shrink-0 rounded-full', !scenario.lastRun ? 'bg-text-4' : failing ? 'bg-error' : changes ? 'bg-warning' : 'bg-success')} />}
                      <span className="min-w-0 flex-1 truncate">{scenario.name}</span>
                      {scenario.request.id === request.id && <span className="text-[10px] text-text-4">this</span>}
                    </button>
                  </li>
                )
              })}
              {ordered.length === 0 && <li className="px-3 py-2 text-[11.5px] text-text-4">No scenarios yet. Set your breakpoints, run Debug once, then save the request: that run becomes the baseline.</li>}
            </ul>
          </aside>
          {selected ? <ScenarioEditor key={selected.id} scenario={selected} connections={connections} /> : <div className="flex-1" />}
        </DialogBody>
      </DialogContent>
    </DialogOverlay>
  )
}
