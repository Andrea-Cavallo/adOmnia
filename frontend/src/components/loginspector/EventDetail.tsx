import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Filter, Send, Share2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { useCollectionsStore } from '@/stores/collections'
import { contractSourcesFromCollections, trafficForEvent, validateLogPayload, callPayloadForEvent, canReproduce, correlationCandidates, eventContext, hideJsonFields, operationalContext, requestDraftFromEvent, unwrapNestedJson, type CorrelationKey, type LogEvent } from '@/lib/loginspector'
import { JsonTree } from './JsonTree'
import { useAppTraffic } from './useAppTraffic'
import { StackTracePanel } from './StackTracePanel'
import type { Prefs, UpdatePrefs } from './prefs'
import type { PayloadContractResult } from '@/lib/loginspector'
import { LEVEL_STYLE } from './EventList'

type DetailTab = 'overview' | 'payloads' | 'json' | 'message' | 'stack' | 'context'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'payloads', label: 'Request / Response' },
  { id: 'json', label: 'JSON' },
  { id: 'message', label: 'Message' },
  { id: 'stack', label: 'Stack Trace' },
  { id: 'context', label: 'Context' },
]

interface EventDetailProps {
  event: LogEvent
  sessionEvents: LogEvent[]
  onClose: () => void
  onFilterBy: (field: string, value: string) => void
  onShowRelated: (key: CorrelationKey, value: string) => void
  onSelectEvent: (event: LogEvent) => void
  hiddenFields: string[]
  prefs: Prefs
  updatePrefs: UpdatePrefs
}

export function EventDetail({ event, sessionEvents, onClose, onFilterBy, onShowRelated, onSelectEvent, hiddenFields, prefs, updatePrefs }: EventDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [copied, setCopied] = useState('')

  const copy = (text: string, token: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(token)
        window.setTimeout(() => setCopied(''), 1200)
      },
      () => setCopied(''),
    )
  }

  const related = correlationCandidates(event)
  const stackLines = useMemo(() => (event.stack ? event.stack.split('\n') : []), [event.stack])
  const hasDecoded = Object.keys(event.decoded).length > 0
  // Logs bury JSON inside JSON strings; unwrapping is what makes the tree
  // navigable, so it is the default.
  const [unwrap, setUnwrap] = useState(true)
  const visibleJson = useMemo(() => {
    const base = hasDecoded ? { ...(event.json as object), __decoded: event.decoded } : event.json
    return hideJsonFields(unwrap ? unwrapNestedJson(base) : base, hiddenFields)
  }, [event.json, event.decoded, hasDecoded, hiddenFields, unwrap])
  const visibleExtra = useMemo(
    () => hideJsonFields(event.extra, hiddenFields) as Record<string, unknown>,
    [event.extra, hiddenFields],
  )
  const operational = useMemo(() => operationalContext(event), [event])
  const pairedCall = useMemo(() => callPayloadForEvent(sessionEvents, event), [event, sessionEvents])
  const requestBody = useMemo(() => unwrapNestedJson(pairedCall?.requestBody ?? operational.requestBody), [operational.requestBody, pairedCall])
  const responseBody = useMemo(() => unwrapNestedJson(pairedCall?.responseBody ?? operational.responseBody), [operational.responseBody, pairedCall])
  const requestHeaders = pairedCall?.requestHeaders ?? operational.requestHeaders
  const responseHeaders = pairedCall?.responseHeaders ?? operational.responseHeaders
  const requestPacket = requestHeaders === null ? requestBody : { headers: requestHeaders, body: requestBody }
  const responsePacket = responseHeaders === null ? responseBody : { status: pairedCall?.status ?? operational.httpStatus, headers: responseHeaders, body: responseBody }
  const hasPayloads = requestPacket !== null || responsePacket !== null
  const surrounding = useMemo(() => eventContext(sessionEvents, event), [event, sessionEvents])
  const reproducible = useMemo(() => canReproduce(event), [event])
  const appTraffic = useAppTraffic(Boolean(event.correlationId || event.traceId || event.requestId))
  const relatedTraffic = useMemo(() => trafficForEvent(appTraffic, event), [appTraffic, event])
  const collections = useCollectionsStore((state) => state.collections)
  const contractSources = useMemo(() => contractSourcesFromCollections(collections), [collections])
  const contractRoute = pairedCall?.url || operational.httpRoute || operational.httpUrl
  const requestContract = useMemo(() => validateLogPayload(contractSources, {
    method: pairedCall?.method || operational.httpMethod,
    route: contractRoute,
    status: pairedCall?.status ?? operational.httpStatus,
    direction: 'request',
    payload: requestBody,
  }), [contractRoute, contractSources, operational.httpMethod, operational.httpStatus, pairedCall, requestBody])
  const responseContract = useMemo(() => validateLogPayload(contractSources, {
    method: pairedCall?.method || operational.httpMethod,
    route: contractRoute,
    status: pairedCall?.status ?? operational.httpStatus,
    direction: 'response',
    payload: responseBody,
  }), [contractRoute, contractSources, operational.httpMethod, operational.httpStatus, pairedCall, responseBody])
  const draft = useMemo(
    () => (reproducible ? requestDraftFromEvent(sessionEvents, event) : null),
    [event, reproducible, sessionEvents],
  )

  const openInComposer = () => {
    if (!draft) return
    useTabsStore.getState().openTab(draft.request)
    useAppStore.getState().setActiveRail('collections')
  }

  useEffect(() => {
    setTab((current) => {
      if (current === 'stack' && !event.stack) return 'overview'
      if (current === 'payloads' && !hasPayloads) return 'overview'
      return current
    })
  }, [event.id, event.stack, hasPayloads])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
      <div className="flex shrink-0 items-start gap-2 border-b border-border-1 bg-surface-1 px-3 py-2">
        <span className={cn('mt-[1px] rounded px-1.5 py-[2px] font-mono text-[9px] font-semibold', LEVEL_STYLE[event.level])}>
          {event.levelRaw || event.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-text-1" title={event.message}>{event.message || '(empty message)'}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-text-4">
            line {event.line}
            {event.lineCount > 1 ? ` (+${event.lineCount - 1})` : ''}
            {event.service ? ` · ${event.service}` : ''}
            {event.pod ? ` · ${event.pod}` : ''}
          </p>
        </div>
        <button
          onClick={() => copy(event.raw, 'raw')}
          title="Copy the original source line"
          className="flex h-6 shrink-0 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-3 hover:border-accent/40 hover:text-text-1"
        >
          {copied === 'raw' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
          Raw
        </button>
        <button onClick={onClose} title="Close details (Esc)" className="mt-0.5 shrink-0 text-text-4 hover:text-error">
          <X size={13} />
        </button>
      </div>

      <div className="flex shrink-0 border-b border-border-1 bg-surface-0">
        {TABS.map((item) => {
          const disabled = (item.id === 'stack' && !event.stack) || (item.id === 'payloads' && !hasPayloads)
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              disabled={disabled}
              className={cn(
                'relative px-3 py-1.5 text-[11px] transition-colors disabled:opacity-35',
                tab === item.id ? 'text-accent-light' : 'text-text-3 hover:text-text-1',
              )}
            >
              {item.label}
              {item.id === 'stack' && event.stack ? <span className="ml-1 text-[9px] text-text-4">{stackLines.length}</span> : null}
              {tab === item.id && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {related.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {related.map((candidate) => (
                <button
                  key={candidate.key}
                  onClick={() => onShowRelated(candidate.key, candidate.value)}
                  title={`Show every event with ${candidate.label} = ${candidate.value}`}
                  className="flex items-center gap-1.5 rounded border border-accent/35 bg-accent/12 px-2 py-1 font-mono text-[10px] text-accent-light hover:bg-accent/20"
                >
                  <Share2 size={10} />
                  {candidate.label}: {candidate.value}
                </button>
              ))}
            </div>
          )}
          {relatedTraffic.length > 0 && (
            <div className="mb-3 rounded border border-border-1 bg-surface-1 px-2 py-1.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">
                adOmnia traffic with the same id · {relatedTraffic.length}
              </p>
              {relatedTraffic.slice(0, 6).map((record) => (
                <div key={record.id} className="flex items-center gap-2 py-[2px] font-mono text-[10px]">
                  <span className="w-14 shrink-0 rounded bg-surface-2 px-1 text-center text-[9px] text-text-3">{record.source}</span>
                  <span className="w-10 shrink-0 text-text-3">{record.method}</span>
                  <span className="min-w-0 flex-1 truncate text-text-2" title={record.url}>{record.url}</span>
                  <span className={record.status >= 400 ? 'text-error' : 'text-success'}>{record.status || ''}</span>
                  <span className="shrink-0 text-[9px] text-text-4" title={record.identifiers.map((identifier) => `${identifier.header}: ${identifier.value}`).join(', ')}>
                    {record.identifiers[0]?.header}
                  </span>
                </div>
              ))}
            </div>
          )}
          {draft && (
            <div className="mb-3 rounded border border-border-1 bg-surface-1 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={openInComposer}
                  title="Create an editable request in the API composer"
                  className="flex h-6 items-center gap-1.5 rounded border border-accent/40 bg-accent/12 px-2 text-[10px] text-accent-light hover:bg-accent/20"
                >
                  <Send size={10} />
                  Open in Composer
                </button>
                <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-text-4">
                  {draft.request.method} {draft.request.url || '—'}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-text-4">
                {draft.missing.length
                  ? <>Missing from the log: <span className="text-warning">{draft.missing.join('; ')}</span>. Nothing is sent until you press Send.</>
                  : 'Every part of the request was present in the log. Nothing is sent until you press Send.'}
              </p>
            </div>
          )}
          {event.duplicateSources && event.duplicateSources.length > 0 && (
            <p className="mb-3 rounded border border-info/35 bg-info/10 px-2 py-1.5 text-[10px] text-info">
              Acquisition copies folded from {event.duplicateSources.map((source) => `${source.sourceName || source.sourceId}:${source.line}`).join(', ')}.
            </p>
          )}
          <FieldGrid
            rows={[
              ['Timestamp', event.ts !== null ? new Date(event.ts).toISOString() : event.tsRaw, ''],
              ['Level', event.level, 'level'],
              ['Service', event.service, 'service'],
              ['Namespace', event.namespace, 'namespace'],
              ['Pod', event.pod, 'pod'],
              ['Container', event.container, 'container'],
              ['Logger', event.logger, 'logger'],
              ['Thread', event.thread, 'thread'],
              ['Correlation ID', event.correlationId, 'correlationId'],
              ['Trace ID', event.traceId, 'traceId'],
              ['Span ID', event.spanId || '', 'spanId'],
              ['Parent span', event.parentSpanId || '', 'parentSpanId'],
              ['Request ID', event.requestId, 'requestId'],
            ]}
            onFilterBy={onFilterBy}
          />
          {(operational.operation || operational.layer || operational.client || operational.httpRoute || operational.httpStatus !== null) && (
            <>
              <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">Operation</p>
              <FieldGrid
                rows={[
                  ['Operation', operational.operation, 'attributes.operation'],
                  ['Layer', operational.layer, 'attributes.layer'],
                  ['Downstream', operational.client, 'attributes.client'],
                  ['Operation status', operational.operationStatus, 'attributes.status'],
                  ['Latency', operational.latencyMs !== null ? `${operational.latencyMs} ms` : '', ''],
                  ['Error', operational.error, 'attributes.error'],
                  ['HTTP', [operational.httpMethod, operational.httpRoute || operational.httpUrl].filter(Boolean).join(' '), ''],
                  ['HTTP status', operational.httpStatus !== null ? String(operational.httpStatus) : '', 'http.status_code'],
                  ['Outcome', operational.outcome, 'event.outcome'],
                  ['Duration', operational.durationMs !== null ? `${operational.durationMs} ms` : '', ''],
                ]}
                onFilterBy={onFilterBy}
              />
            </>
          )}
          {(operational.serviceVersion || operational.environment || operational.sourceFile) && (
            <>
              <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">Runtime and source</p>
              <FieldGrid
                rows={[
                  ['Service version', operational.serviceVersion, 'service.version'],
                  ['Environment', operational.environment, 'environment'],
                  ['Source', [operational.sourceFile, operational.sourceLine].filter(Boolean).join(':'), ''],
                  ['Function', operational.sourceFunction, 'source.function'],
                ]}
                onFilterBy={onFilterBy}
              />
            </>
          )}
          {event.parseError && (
            <p className="mt-3 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 font-mono text-[10px] text-warning">
              Not parsable: {event.parseError}
            </p>
          )}
        </div>
      )}

      {tab === 'json' && (
        event.json
          ? (
            <JsonTree
              value={visibleJson}
              actions={
                <button
                  onClick={() => setUnwrap((value) => !value)}
                  title="Unwrap JSON that was escaped inside string fields"
                  className={cn(
                    'h-6 rounded border px-2 text-[10px] transition-colors',
                    unwrap ? 'border-accent/50 bg-accent/20 text-accent-light' : 'border-border-2 text-text-3 hover:text-text-1',
                  )}
                >
                  Unwrap
                </button>
              }
            />
          )
          : (
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              <p className="mb-2 text-[11px] text-text-4">This event is not structured JSON. The original line is shown below.</p>
              <pre className="whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-2">{event.raw}</pre>
            </div>
          )
      )}

      {tab === 'payloads' && hasPayloads && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {pairedCall && (
            <div className="flex shrink-0 flex-wrap gap-x-3 border-b border-border-1 bg-surface-1 px-3 py-1 font-mono text-[9px] text-text-4">
              <span>{pairedCall.method || 'CALL'} {pairedCall.url}</span>
              {pairedCall.status !== null && <span className={pairedCall.status >= 400 ? 'text-error' : 'text-success'}>{pairedCall.status}</span>}
              <span>{pairedCall.inferred ? 'event-local · association not inferred across rows' : pairedCall.key}</span>
              {pairedCall.requestEvent && <span>request {pairedCall.requestEvent.sourceName}:{pairedCall.requestEvent.line}</span>}
              {pairedCall.responseEvent && <span>response {pairedCall.responseEvent.sourceName}:{pairedCall.responseEvent.line}</span>}
            </div>
          )}
          <div className="grid min-h-0 flex-1 grid-rows-2 overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden border-b border-border-1">
            {requestPacket !== null
              ? <JsonTree value={requestPacket} title="Request" className="min-h-0 flex-1" />
              : <p className="px-3 py-3 text-[11px] text-text-4">No request payload in this call.</p>}
            <ContractReport result={requestContract} onFilterBy={onFilterBy} />
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden">
            {responsePacket !== null
              ? <JsonTree value={responsePacket} title="Response" className="min-h-0 flex-1" />
              : <p className="px-3 py-3 text-[11px] text-text-4">No response payload in this call.</p>}
            <ContractReport result={responseContract} onFilterBy={onFilterBy} />
          </div>
          </div>
        </div>
      )}

      {tab === 'message' && (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-text-1">{event.message}</pre>
          {hasDecoded && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">Decoded JSON payload</p>
              <pre className="whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-2">
                {JSON.stringify(event.decoded, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {tab === 'stack' && (
        <StackTracePanel stack={event.stack} prefs={prefs} updatePrefs={updatePrefs} />
      )}

      {tab === 'context' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 overflow-auto px-3 py-2" style={{ maxHeight: '45%' }}>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">Around this event · ignores active query</p>
            <ContextEvents title={`±5 lines · ${event.sourceName || 'source'}`} events={surrounding.source} onSelect={onSelectEvent} />
            <ContextEvents title="±5 seconds · all services" events={surrounding.temporal} onSelect={onSelectEvent} />
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">Kubernetes / OpenShift</p>
            <FieldGrid
              rows={[
                ['Namespace', event.namespace, 'namespace'],
                ['Pod', event.pod, 'pod'],
                ['Container', event.container, 'container'],
                ['Service', event.service, 'service'],
              ]}
              onFilterBy={onFilterBy}
            />
            <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">Tracing</p>
            <FieldGrid
              rows={[
                ['Trace ID', event.traceId, 'traceId'],
                ['Span ID', event.spanId || '', 'spanId'],
                ['Parent span', event.parentSpanId || '', 'parentSpanId'],
                ['Correlation ID', event.correlationId, 'correlationId'],
                ['Request ID', event.requestId, 'requestId'],
                ['Thread', event.thread, 'thread'],
                ['Logger', event.logger, 'logger'],
                ['Source line', String(event.line), ''],
                ['Source file', event.sourceName || '', 'sourceName'],
                ['Source ID', event.sourceId || '', ''],
              ]}
              onFilterBy={onFilterBy}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-1">
            <p className="shrink-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">
              Other fields ({Object.keys(visibleExtra).length})
            </p>
            {Object.keys(visibleExtra).length > 0
              ? <JsonTree value={visibleExtra} />
              : <p className="px-3 pb-3 text-[11px] text-text-4">Every field of this event was recognized.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function ContractReport({ result, onFilterBy }: { result: PayloadContractResult; onFilterBy: (field: string, value: string) => void }) {
  if (!result.matched) {
    return result.reason
      ? <p className="shrink-0 border-t border-border-1 px-3 py-1 text-[9px] text-text-4">Contract: {result.reason}</p>
      : null
  }
  const label = `${result.collectionName} · ${result.method} ${result.openApiPath}`
  if (result.violations.length === 0) {
    return (
      <p className="shrink-0 border-t border-border-1 px-3 py-1 text-[9px] text-success" title={result.reason || undefined}>
        {result.reason ? `Contract ${label}: ${result.reason}` : `Matches the ${result.direction} contract of ${label}.`}
      </p>
    )
  }
  return (
    <div className="max-h-[38%] shrink-0 overflow-auto border-t border-border-1 bg-surface-1">
      <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-warning">
        {result.violations.length} contract violation(s) · {label}
        {result.required.length ? ` · required: ${result.required.join(', ')}` : ''}
      </p>
      {result.violations.map((violation, index) => (
        <div key={`${violation.path}-${index}`} className="flex items-start gap-2 px-3 py-[2px] font-mono text-[10px]">
          <button
            onClick={() => onFilterBy('message', violation.path.replace(/^\$\./, ''))}
            title="Filter events mentioning this field"
            className="shrink-0 text-accent-light hover:underline"
          >
            {violation.path}
          </button>
          <span className="min-w-0 flex-1 text-text-2">{violation.message} — <span className="text-text-4">{violation.expected}</span></span>
        </div>
      ))}
    </div>
  )
}

function ContextEvents({ title, events, onSelect }: { title: string; events: LogEvent[]; onSelect: (event: LogEvent) => void }) {
  return (
    <div className="mb-2 rounded border border-border-1 bg-surface-1">
      <p className="border-b border-border-1 px-2 py-1 font-mono text-[9px] text-text-4">{title} · {events.length}</p>
      {events.length === 0 ? (
        <p className="px-2 py-1.5 text-[10px] text-text-4">No neighboring event.</p>
      ) : events.slice(0, 30).map((candidate) => (
        <button key={candidate.id} onClick={() => onSelect(candidate)} className="flex w-full gap-2 px-2 py-1 text-left hover:bg-surface-2">
          <span className="w-9 shrink-0 text-right font-mono text-[9px] text-text-4">{candidate.line}</span>
          <span className="w-20 shrink-0 truncate font-mono text-[9px] text-text-3">{candidate.service || candidate.sourceName}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{candidate.message}</span>
        </button>
      ))}
    </div>
  )
}

function FieldGrid({ rows, onFilterBy }: { rows: [string, string, string][]; onFilterBy: (field: string, value: string) => void }) {
  const filled = rows.filter(([, value]) => value)
  if (!filled.length) return <p className="text-[11px] text-text-4">No value available.</p>
  return (
    <div className="grid grid-cols-[124px_minmax(0,1fr)] gap-x-3 gap-y-1">
      {filled.map(([label, value, field]) => (
        <div key={label} className="contents">
          <span className="py-[2px] text-[10px] text-text-4">{label}</span>
          <span className="group flex min-w-0 items-center gap-1.5 py-[2px]">
            <span className="min-w-0 break-all font-mono text-[11px] text-text-1">{value}</span>
            {field && (
              <button
                onClick={() => onFilterBy(field, value)}
                title={`Filter by ${field}:${value}`}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-text-4 hover:text-accent-light focus:text-accent-light"
              >
                <Filter size={10} />
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
