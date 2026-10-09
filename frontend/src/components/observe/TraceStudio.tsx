import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code2, Copy, GitCompare, Play, Radio, ScrollText, Search, Square, Trash2 } from 'lucide-react'
import { openTraceLogs } from '@/lib/otlp-logs'
import { cn } from '@/lib/utils'
import { useServerPort } from '@/lib/useServerPort'
import { clearOtlp, getOtlpMap, getOtlpTrace, listOtlpTraces, otlpStatus, startOtlp, stopOtlp, type OtlpServiceMap, type OtlpSpan, type OtlpStatus, type OtlpTraceSummary } from '@/lib/otlp-api'
import { ServiceMapView } from './ServiceMapView'
import { traceTreeRows } from './traceTree'
import { compareTraces, serviceColor, spanInsights, spanSource, type SpanInsight } from './traceStudioModel'
import { openSpanSource } from './openSpanSource'

const CATEGORY_LABEL: Record<string, string> = { http: 'HTTP', db: 'DB', rpc: 'RPC', messaging: 'MSG' }
const ENDPOINT_HINT = 'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318'

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : value >= 10 ? `${Math.round(value)} ms` : `${value.toFixed(2)} ms`
}

function ServiceDot({ service }: { service: string }) {
  return <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: serviceColor(service) }} aria-hidden="true" />
}

function InsightBadges({ insight }: { insight?: SpanInsight }) {
  if (!insight) return null
  return (
    <>
      {insight.errorOrigin && <span title="The error starts here: the failing spans above only propagate it" className="rounded bg-error/15 px-1 text-[9px] font-semibold text-error">error origin</span>}
      {insight.networkMs !== undefined && <span title="Client time not spent in the server handler: network, TLS, queues" className="rounded bg-surface-3 px-1 text-[9px] text-text-3">net {ms(insight.networkMs)}</span>}
      {insight.brokerDelayMs !== undefined && <span title="Time the message waited in the broker before the consumer picked it up" className="rounded bg-warning/10 px-1 text-[9px] text-warning">queued {ms(insight.brokerDelayMs)}</span>}
      {!!insight.retry && <span title="Repeats an earlier attempt of the same call" className="rounded bg-warning/10 px-1 text-[9px] text-warning">retry {insight.retry}</span>}
      {insight.parallel && <span title="Runs at the same time as a sibling" className="rounded bg-surface-3 px-1 text-[9px] text-text-3">parallel</span>}
      {insight.async && <span title="Finishes after its parent: asynchronous work" className="rounded bg-surface-3 px-1 text-[9px] text-text-3">async</span>}
    </>
  )
}

function SpanDetail({ span, insight }: { span: OtlpSpan; insight?: SpanInsight }) {
  const source = spanSource(span)
  const attrs = Object.entries(span.attributes ?? {}).filter(([key]) => !key.startsWith('code.'))
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex items-center gap-2">
        <ServiceDot service={span.service} />
        <span className="font-semibold text-text-1">{span.service}</span>
        <span className="truncate font-mono text-text-2">{span.name}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-2">{span.kind}</span>
        {CATEGORY_LABEL[span.category] && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{CATEGORY_LABEL[span.category]}</span>}
        <span className={cn('rounded px-1.5 py-0.5', span.statusCode === 'ERROR' ? 'bg-error/10 text-error' : 'bg-surface-3 text-text-3')}>{span.statusCode}{span.statusMessage ? `: ${span.statusMessage}` : ''}</span>
        <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-text-2">{ms(span.durationMs)}</span>
        <InsightBadges insight={insight} />
      </div>
      {source && (
        <button type="button" onClick={() => void openSpanSource(source.file, source.line)} title={`${source.file}:${source.line}`} className="flex max-w-full items-center gap-1 rounded border border-accent/50 px-2 py-1 text-accent hover:bg-accent/10">
          <Code2 size={12} aria-hidden="true" /> <span className="truncate">Open {source.function ?? 'source'} · {source.file.split(/[\\/]/).pop()}:{source.line}</span>
        </button>
      )}
      <button type="button" onClick={() => openTraceLogs(span.traceId)} title="Log Inspector filtered on traceId: the service logs must carry it (trace_id / traceId field)" className="flex items-center gap-1 rounded border border-border-2 px-2 py-1 text-text-2 hover:border-accent hover:text-accent">
        <ScrollText size={12} aria-hidden="true" /> Logs of this trace
      </button>
      {attrs.length > 0 && (
        <table className="w-full table-fixed font-mono text-[10.5px]">
          <tbody>{attrs.map(([key, value]) => (
            <tr key={key} className="border-t border-border-1 align-top"><td className="w-2/5 truncate py-0.5 pr-2 text-text-3" title={key}>{key}</td><td className="break-words py-0.5 text-text-1">{value}</td></tr>
          ))}</tbody>
        </table>
      )}
      {(span.events ?? []).length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-text-4">Events</p>
          {span.events!.map((event, index) => (
            <div key={index} className="border-t border-border-1 py-0.5 font-mono text-[10.5px]">
              <span className="text-text-1">{event.name}</span>
              {event.attributes?.['exception.message'] && <span className="ml-2 text-error">{event.attributes['exception.message']}</span>}
            </div>
          ))}
        </div>
      )}
      <p className="font-mono text-[10px] text-text-4">span {span.spanId}{span.parentSpanId ? ` · parent ${span.parentSpanId}` : ''}</p>
    </div>
  )
}

/** Trace Studio: real OpenTelemetry traces received locally over OTLP. */
export function TraceStudio() {
  const port = useServerPort()
  const [status, setStatus] = useState<OtlpStatus | null>(null)
  const [traces, setTraces] = useState<OtlpTraceSummary[]>([])
  const [selected, setSelected] = useState('')
  const [spans, setSpans] = useState<OtlpSpan[]>([])
  const [spanId, setSpanId] = useState('')
  const [query, setQuery] = useState('')
  const [compare, setCompare] = useState<string[]>([])
  const [comparison, setComparison] = useState<ReturnType<typeof compareTraces> | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'traces' | 'map'>('traces')
  const [serviceMap, setServiceMap] = useState<OtlpServiceMap | null>(null)

  const refresh = useCallback(async () => {
    if (!port) return
    try {
      const [nextStatus, nextTraces, nextMap] = await Promise.all([otlpStatus(port), listOtlpTraces(port), view === 'map' ? getOtlpMap(port) : Promise.resolve(null)])
      setStatus(nextStatus)
      setTraces(nextTraces)
      if (nextMap) setServiceMap(nextMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [port, view])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!status?.running) return
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [status?.running, refresh])

  useEffect(() => {
    if (!port || !selected) return
    void getOtlpTrace(port, selected).then((next) => {
      setSpans(next)
      setSpanId((current) => (next.some((span) => span.spanId === current) ? current : next[0]?.spanId ?? ''))
    })
  }, [port, selected, traces])

  useEffect(() => {
    if (!port || compare.length !== 2) { setComparison(null); return }
    void Promise.all(compare.map((id) => getOtlpTrace(port, id))).then(([left, right]) => setComparison(compareTraces(left, right)))
  }, [port, compare])

  const toggle = async () => {
    setError('')
    const next = status?.running ? await stopOtlp(port) : await startOtlp(port)
    setStatus(next)
    if (next.error && !next.running) setError(`Could not listen: ${next.error}`)
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? traces.filter((trace) => `${trace.root} ${trace.services.join(' ')} ${trace.traceId}`.toLowerCase().includes(needle)) : traces
  }, [traces, query])
  const rows = useMemo(() => traceTreeRows(spans.map((span) => ({ ...span, parentSpanId: span.parentSpanId ?? '' }))), [spans])
  const start = spans.length ? Math.min(...spans.map((span) => span.startMs)) : 0
  const end = spans.length ? Math.max(...spans.map((span) => span.startMs + span.durationMs)) : 0
  const total = Math.max(end - start, 0.001)
  const current = spans.find((span) => span.spanId === spanId)
  const insights = useMemo(() => spanInsights(spans), [spans])

  return (
    <div className="flex min-h-[480px] flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 bg-surface-0 px-3 py-1.5 text-[11px]">
        <button type="button" onClick={() => void toggle()} disabled={!port || !status} className={cn('flex h-7 items-center gap-1.5 rounded px-2.5 font-medium', status?.running ? 'border border-border-2 text-text-2 hover:text-text-1' : 'bg-accent text-white hover:bg-accent-hover')}>
          {status?.running ? <><Square size={11} /> Stop receiver</> : <><Play size={11} /> Start OTLP receiver</>}
        </button>
        {status?.running ? (
          <span className="flex items-center gap-1.5 text-success"><Radio size={12} className="animate-pulse" /> HTTP {status.httpAddr} · gRPC {status.grpcAddr}</span>
        ) : (
          <span className="text-text-4">Local only: services export to 127.0.0.1, nothing leaves this machine.</span>
        )}
        <button type="button" onClick={() => void navigator.clipboard?.writeText(ENDPOINT_HINT)} title="Copy the environment variable for the OpenTelemetry SDK" className="flex items-center gap-1 rounded border border-border-2 px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:text-text-1">
          <Copy size={10} /> {ENDPOINT_HINT}
        </button>
        <span className="ml-auto flex overflow-hidden rounded border border-border-2">
          {(['traces', 'map'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setView(value)} className={cn('h-6 px-2 text-[10px] font-medium capitalize', view === value ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2 hover:text-text-1')}>{value === 'map' ? 'Service map' : 'Traces'}</button>
          ))}
        </span>
        <span className="text-text-4">{status?.traces ?? 0} traces · {status?.spans ?? 0} spans</span>
        <button type="button" onClick={() => { void clearOtlp(port).then(setStatus); setTraces([]); setSelected(''); setSpans([]); setCompare([]) }} title="Clear received traces" className="grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text-1"><Trash2 size={12} /></button>
      </div>
      {error && <p className="border-b border-border-1 bg-error/10 px-3 py-1 text-[11px] text-error">{error}</p>}

      {view === 'map' ? <ServiceMapView map={serviceMap} onOpenTrace={(traceId) => { setSelected(traceId); setCompare([]); setView('traces') }} /> : (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[300px] min-w-[220px] flex-col border-r border-border-1">
          <div className="relative border-b border-border-1 p-2">
            <Search size={11} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-4" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter traces" className="h-7 w-full rounded border border-border-2 bg-surface-1 pl-6 pr-2 text-[11px] text-text-1 outline-none focus:border-accent/50" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 && <p className="p-3 text-[11px] text-text-4">{status?.running ? 'Waiting for spans… point the service at the endpoint above.' : 'Start the receiver, then run a service instrumented with OpenTelemetry.'}</p>}
            {visible.map((trace) => (
              <div key={trace.traceId} className={cn('flex items-start gap-2 border-b border-border-1/60 px-2 py-1.5 hover:bg-surface-2', selected === trace.traceId && 'bg-accent/10')}>
                <input type="checkbox" checked={compare.includes(trace.traceId)} title="Compare (pick two)" onChange={() => setCompare((ids) => (ids.includes(trace.traceId) ? ids.filter((id) => id !== trace.traceId) : [...ids, trace.traceId].slice(-2)))} className="mt-1 accent-[var(--color-accent)]" />
                <button type="button" onClick={() => { setSelected(trace.traceId); setCompare([]) }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-mono text-[11px] text-text-1">{trace.root}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-4">
                    {trace.services.map((service) => <ServiceDot key={service} service={service} />)}
                    {ms(trace.durationMs)} · {trace.spans} spans
                    {trace.errors > 0 && <span className="rounded bg-error/10 px-1 text-error">{trace.errors} err</span>}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {comparison ? (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-1"><GitCompare size={12} /> Before → after: matched by service and span name</p>
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wide text-text-4"><tr><th className="py-1">Step</th><th className="py-1 text-right">A</th><th className="py-1 text-right">B</th><th className="py-1 text-right">Δ</th></tr></thead>
                <tbody>{comparison.map((row) => (
                  <tr key={row.key} className="border-t border-border-1">
                    <td className="py-1"><span className="flex items-center gap-1.5"><ServiceDot service={row.service} /><span className="font-mono text-text-1">{row.name}</span></span></td>
                    <td className="py-1 text-right font-mono text-text-2">{row.left === undefined ? '—' : ms(row.left)}</td>
                    <td className="py-1 text-right font-mono text-text-2">{row.right === undefined ? '—' : ms(row.right)}</td>
                    <td className={cn('py-1 text-right font-mono', row.deltaMs === undefined ? 'text-text-4' : row.deltaMs > 0 ? 'text-error' : 'text-success')}>{row.deltaMs === undefined ? (row.left === undefined ? 'new' : 'gone') : `${row.deltaMs > 0 ? '+' : ''}${ms(row.deltaMs)}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : !spans.length ? (
            <p className="p-4 text-[11px] text-text-4">{compare.length === 1 ? 'Pick a second trace to compare.' : 'Select a trace to see its spans.'}</p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div role="listbox" aria-label="Spans" className="min-h-0 min-w-0 flex-[3] overflow-y-auto">
                {rows.map(({ span, depth }) => {
                  const left = ((span.startMs - start) / total) * 100
                  const width = Math.max(0.5, (span.durationMs / total) * 100)
                  return (
                    <button key={span.spanId} type="button" role="option" aria-selected={span.spanId === spanId} onClick={() => setSpanId(span.spanId)}
                      className={cn('grid w-full grid-cols-[minmax(0,1fr)_minmax(120px,1.4fr)_64px] items-center gap-2 border-b border-border-1/50 px-2 py-1 text-left hover:bg-surface-2', span.spanId === spanId && 'bg-accent/10')}>
                      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px]" style={{ paddingLeft: Math.min(depth, 10) * 12 }}>
                        <ServiceDot service={span.service} />
                        {CATEGORY_LABEL[span.category] && <span className="rounded bg-surface-3 px-1 text-[9px] text-text-3">{CATEGORY_LABEL[span.category]}</span>}
                        <span className="truncate text-text-1" title={`${span.service}: ${span.name}`}>{span.name}</span>
                        <InsightBadges insight={insights.get(span.spanId)} />
                      </span>
                      <span className="relative h-2.5 rounded-sm bg-surface-2">
                        <span className={cn('absolute inset-y-0 rounded-sm', span.statusCode === 'ERROR' && 'ring-1 ring-error')} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: span.statusCode === 'ERROR' ? 'var(--color-error)' : serviceColor(span.service) }} />
                      </span>
                      <span className="text-right font-mono text-[10px] text-text-3">{ms(span.durationMs)}</span>
                    </button>
                  )
                })}
              </div>
              <div className="min-h-0 w-[320px] min-w-[240px] overflow-y-auto border-l border-border-1 p-3">
                {current && <SpanDetail span={current} insight={insights.get(current.spanId)} />}
              </div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  )
}
