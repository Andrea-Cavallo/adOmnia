import { useMemo, useState } from 'react'
import { AlertTriangle, Repeat, ShieldCheck, Timer } from 'lucide-react'
import type { GoIDEArchitecture } from '@/lib/code-studio-api'
import { NO_GOROUTINE_FILTER, groupGoroutines, shortPackage, type ArchGoroutine, type GoroutineFilter } from './codeStudioArchitecture'
import { SiteLink } from './CodeStudioInterfaceExplorer'

const KINDS: Array<{ kind: string; label: string; hint: string }> = [
  { kind: 'go', label: 'go', hint: '`go` statements' },
  { kind: 'errgroup', label: 'errgroup', hint: 'errgroup.Group.Go / TryGo' },
  { kind: 'waitgroup-go', label: 'wg.Go', hint: 'sync.WaitGroup.Go' },
  { kind: 'afterfunc', label: 'AfterFunc', hint: 'time.AfterFunc and context.AfterFunc' },
]

const RISK_HELP: Record<string, string> = {
  'unbounded-loop-spawn': 'Started inside a loop with no visible bound (constant limit, SetLimit or a semaphore): the number of goroutines follows the input size.',
  'loop-var-capture': 'The closure uses the loop variable and the module targets Go < 1.22, where all iterations share one variable.',
  'no-wait': 'Nothing visible waits for it: no WaitGroup, errgroup or channel. It may outlive its caller.',
  'fire-and-forget-in-handler': 'Started from a request handler with nothing waiting for it: it can outlive the request and its context.',
  'no-ctx-cancel': 'Runs an endless loop that does not observe ctx.Done() or a stop channel, so it cannot be told to stop.',
  'no-recover': 'Reachable from an HTTP handler or job and has no recover(): a panic here takes the whole process down.',
}

const SEVERITY_CLASS: Record<string, string> = {
  high: 'bg-danger/15 text-danger',
  medium: 'bg-warning/15 text-warning',
  low: 'bg-surface-3 text-text-2',
}

function Chip({ children, title, className = 'bg-surface-3 text-text-2' }: { children: React.ReactNode; title?: string; className?: string }) {
  return <span title={title} className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] ${className}`}>{children}</span>
}

function GoroutineRow({ item }: { item: ArchGoroutine }) {
  const launches = item.shape === 'literal' ? 'func literal' : item.launches ? shortPackage(item.launches) : 'dynamic func value'
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-0.5 pl-5 hover:bg-surface-2">
      <SiteLink site={item.site} label={`:${item.site.line}`} />
      <Chip title="How it is started" className="bg-accent/10 text-accent">{item.kind}</Chip>
      <Chip title="Shape of the function that is started">{item.shape}</Chip>
      <span className="truncate font-mono text-[11px] text-text-2" title={item.launchesId || undefined}>→ {launches}</span>
      {item.inLoop && <Chip title={`Started inside a ${item.loopKind} loop${item.bounded ? ' with a bound' : ''}`}><Repeat size={9} aria-hidden="true" />{item.loopKind}{item.bounded ? ' · bounded' : ''}</Chip>}
      {item.ctx && <Chip title={item.cancellable ? 'Uses a context and observes Done()/Err()' : 'Uses a context but never observes Done()/Err()'}><Timer size={9} aria-hidden="true" />ctx{item.cancellable ? '' : ' (not observed)'}</Chip>}
      {item.waitGroup && <Chip title="Tracked by a sync.WaitGroup"><ShieldCheck size={9} aria-hidden="true" />wg</Chip>}
      {item.errGroup && <Chip title="Tracked by an errgroup.Group"><ShieldCheck size={9} aria-hidden="true" />errgroup</Chip>}
      {(item.channels ?? 0) > 0 && <Chip title="Channel operations in its body or channels passed to it">chan ×{item.channels}</Chip>}
      {item.recover && <Chip title="Calls recover()">recover</Chip>}
      {item.risks.map((risk) => <Chip key={risk} title={RISK_HELP[risk] ?? risk} className={SEVERITY_CLASS[item.severity] ?? SEVERITY_CLASS.low}><AlertTriangle size={9} aria-hidden="true" />{risk}</Chip>)}
      {(item.entries ?? []).length > 0 && <span className="truncate text-[10px] text-text-4" title="Entry points that reach the function starting this goroutine">from {(item.entries ?? []).join(', ')}</span>}
    </div>
  )
}

/** Goroutine avviate dal codice (analisi statica), per package e funzione, con gli indizi di rischio. */
export function CodeStudioGoroutinesView({ report, query }: { report: GoIDEArchitecture; query: string }) {
  const [options, setOptions] = useState<Omit<GoroutineFilter, 'query'>>({ risksOnly: false, inLoopOnly: false, kinds: new Set() })
  const filter = useMemo<GoroutineFilter>(() => ({ ...NO_GOROUTINE_FILTER, ...options, query }), [options, query])
  const groups = useMemo(() => groupGoroutines(report.goroutines, filter), [filter, report.goroutines])
  const total = report.goroutines.length
  const toggleKind = (kind: string) => setOptions((current) => {
    const kinds = new Set(current.kinds)
    if (!kinds.delete(kind)) kinds.add(kind)
    return { ...current, kinds }
  })
  const pill = (on: boolean) => `rounded px-1.5 py-0.5 ${on ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-3'}`
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-2 py-1 text-text-3">
        <button type="button" aria-pressed={options.risksOnly} onClick={() => setOptions({ ...options, risksOnly: !options.risksOnly })} className={pill(options.risksOnly)} title="Only goroutines with at least one risk hint">Risks only</button>
        <button type="button" aria-pressed={options.inLoopOnly} onClick={() => setOptions({ ...options, inLoopOnly: !options.inLoopOnly })} className={pill(options.inLoopOnly)} title="Only goroutines started inside a loop">In loops</button>
        <span className="mx-0.5 h-3 w-px bg-border-1" aria-hidden="true" />
        {KINDS.map(({ kind, label, hint }) => <button key={kind} type="button" aria-pressed={options.kinds.has(kind)} onClick={() => toggleKind(kind)} title={hint} className={pill(options.kinds.has(kind))}>{label}</button>)}
        <span className="ml-auto tabular-nums text-text-4">{groups.reduce((sum, group) => sum + group.count, 0)} of {total}{report.truncated ? ' (analysis truncated)' : ''}</span>
      </div>
      {total === 0
        ? <p className="p-3 text-text-4">No goroutines are started in this project.</p>
        : groups.length === 0
          ? <p className="p-3 text-text-4">No goroutine matches the filters.</p>
          : (
            <div className="min-h-0 flex-1 overflow-auto py-1">
              <p className="px-2 pb-1 text-[10px] text-text-4">Static hints from the source, not proof of a bug. Hover a risk for what it looks at.</p>
              {groups.map((group) => (
                <section key={group.package} className="mb-2">
                  <h4 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">{shortPackage(group.package)} ({group.count}{group.risky ? `, ${group.risky} with hints` : ''})</h4>
                  {group.functions.map((fn) => (
                    <div key={fn.function}>
                      <div className="px-2 py-0.5 font-mono text-[11px] text-text-1">{fn.function}</div>
                      {fn.items.map((item) => <GoroutineRow key={`${item.site.relativePath}:${item.site.line}:${item.site.column}:${item.kind}`} item={item} />)}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
    </>
  )
}
