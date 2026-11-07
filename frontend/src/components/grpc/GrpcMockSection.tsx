/**
 * The gRPC mock of a call: a local server built from the same .proto files or protoset, answering by rule.
 * The rules travel with the request (and the workspace export); the server is one per app, like the WebSocket mock.
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Play, Plus, Square, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { visibleInterval } from '@/lib/visiblePolling'
import { uid, type GrpcMockRuleSetting, type RequestItem } from '@/lib/types'
import { clearGrpcMockHits, grpcMockStatus, setGrpcMockRules, startGrpcMock, stopGrpcMock, type GrpcMockStatus } from '@/lib/grpc/grpcApi'
import { descriptorSource, grpcSettings, mockRulesOf } from '@/lib/grpc/grpcRequest'
import { findMethod, sampleMessage } from '@/lib/grpc/grpcSchema'
import { grpcDescriptorsOf, useGrpcDescriptors } from '@/stores/grpcDescriptors'
import { MiniButton, NumberField, SectionBlock } from '@/components/websocket/wsUi'

const POLL_MS = 1200
const MAX_PORT = 65535
const IDLE_SCHEMA = grpcDescriptorsOf('')
const STATUSES = ['OK', 'INVALID_ARGUMENT', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'UNIMPLEMENTED', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']

const fieldClass = 'h-7 min-w-0 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent/50'

export function GrpcMockSection({ tabId, request, onChange }: { tabId: string; request: RequestItem; onChange: (request: RequestItem) => void }) {
  const settings = grpcSettings(request)
  const schema = useGrpcDescriptors((state) => state.byTab[tabId]) ?? IDLE_SCHEMA
  const [status, setStatus] = useState<GrpcMockStatus | null>(null)
  const [error, setError] = useState('')
  const rules = settings.mockRules ?? []
  const offline = settings.source !== 'reflection'
  const running = !!status?.running
  const methods = (schema.descriptors?.services ?? []).flatMap((service) => service.methods.map((method) => ({ service: service.name, method })))

  const poll = useCallback(async () => {
    try { setStatus(await grpcMockStatus()) } catch { setStatus(null) }
  }, [])
  useEffect(() => { void poll() }, [poll])
  useEffect(() => (running ? visibleInterval(() => void poll(), POLL_MS, { scope: 'grpc', kind: 'live' }) : undefined), [poll, running])

  const setRules = (next: GrpcMockRuleSetting[]) => {
    const updated = { ...request, grpc: { ...settings, mockRules: next } }
    onChange(updated)
    if (running) void setGrpcMockRules(mockRulesOf(grpcSettings(updated))).catch((reason: unknown) => setError(String(reason)))
  }
  const updateRule = (id: string, patch: Partial<GrpcMockRuleSetting>) => setRules(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))

  const addRule = () => {
    const method = findMethod(schema.descriptors, settings.service, settings.method)
    const output = method ? schema.descriptors?.schemas?.[method.output_type] ?? [] : []
    const reply = JSON.stringify(sampleMessage(output, schema.descriptors?.schemas ?? {}), null, 2)
    setRules([...rules, { id: uid(), name: `Rule ${rules.length + 1}`, enabled: true, method: settings.method, match: '', response: method?.server_streaming ? `[${reply}]` : reply, status: 'OK', message: '', delayMs: 0 }])
  }

  const start = async () => {
    setError('')
    try {
      const started = await startGrpcMock(settings.mockPort ?? 0, descriptorSource(settings), mockRulesOf(settings))
      if (!settings.mockPort) onChange({ ...request, grpc: { ...settings, mockPort: started.port } })
      await poll()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const stop = async () => {
    await stopGrpcMock().catch(() => undefined)
    await poll()
  }

  const address = status?.port ? `127.0.0.1:${status.port}` : ''
  return (
    <>
      <SectionBlock title="Mock server" hint={offline ? 'A local gRPC server built from this call\'s schema. Every method answers: by rule, or with an empty message. Reflection is on.' : 'The mock is built from .proto files or a protoset: choose one in the Schema section.'}>
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" onClick={() => void stop()} className="inline-flex h-8 items-center gap-2 rounded border border-error/30 bg-error/10 px-3 text-[11px] font-semibold text-error hover:bg-error/20"><Square size={12} /> Stop mock</button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={!offline} className="inline-flex h-8 items-center gap-2 rounded bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"><Play size={12} /> Start mock</button>
          )}
          <NumberField label="Port" min={0} value={settings.mockPort ?? 0} max={MAX_PORT} onChange={(mockPort) => onChange({ ...request, grpc: { ...settings, mockPort } })} suffix={settings.mockPort ? '' : 'auto'} />
          {address && (
            <>
              <code className="rounded border border-accent/20 bg-accent/10 px-2 py-1 font-mono text-[11px] text-accent">{address}</code>
              <MiniButton onClick={() => onChange({ ...request, url: address, grpc: { ...settings, tls: false } })} title="Point this call at the mock"><ArrowRightLeft size={12} /> Use as address</MiniButton>
            </>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-text-4"><span className={cn('h-2 w-2 rounded-full', running ? 'bg-success' : 'bg-text-4')} />{running ? `${status?.hits.length ?? 0} hits` : 'Stopped'}</span>
        </div>
        {error && <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-error">{error}</p>}
      </SectionBlock>

      <SectionBlock title="Rules" hint={<>The first enabled rule whose method matches and whose text is in the request answers. The reply can use <code className="text-accent">{'{{request.field}}'}</code>, <code>{'{{$uuid}}'}</code>, <code>{'{{$now}}'}</code>; a server stream takes a JSON array.</>} right={<MiniButton onClick={addRule}><Plus size={12} /> Rule</MiniButton>}>
        {rules.length === 0 && <p className="text-[11px] text-text-4">No rules: every method answers with an empty message.</p>}
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <div key={rule.id} className={cn('rounded-md border bg-surface-0 p-2', rule.enabled ? 'border-border-2' : 'border-border-1 opacity-60')}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} aria-label="Enabled" className="h-3.5 w-3.5 accent-accent" />
                <input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} aria-label="Rule name" className={cn(fieldClass, 'w-28')} />
                <select value={rule.method} onChange={(event) => updateRule(rule.id, { method: event.target.value })} aria-label="Method" className={cn(fieldClass, 'w-36')}>
                  <option value="">Any method</option>
                  {methods.map((item) => <option key={`${item.service}/${item.method.name}`} value={item.method.name}>{item.method.name}</option>)}
                  {rule.method && !methods.some((item) => item.method.name === rule.method) && <option value={rule.method}>{rule.method}</option>}
                </select>
                <input value={rule.match} onChange={(event) => updateRule(rule.id, { match: event.target.value })} placeholder="when request contains…" aria-label="Match text" className={cn(fieldClass, 'min-w-[120px] flex-1 font-mono')} />
                <select value={rule.status} onChange={(event) => updateRule(rule.id, { status: event.target.value })} aria-label="Status" className={cn(fieldClass, 'w-40 font-mono')}>
                  {STATUSES.map((code) => <option key={code} value={code}>{code}</option>)}
                </select>
                <NumberField label="Delay" min={0} value={rule.delayMs} max={30000} onChange={(delayMs) => updateRule(rule.id, { delayMs })} suffix="ms" />
                <button type="button" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))} aria-label="Delete rule" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={12} /></button>
              </div>
              {rule.status === 'OK' ? (
                <textarea value={rule.response} onChange={(event) => updateRule(rule.id, { response: event.target.value })} rows={4} spellCheck={false} aria-label="Reply" className="w-full resize-y rounded border border-border-2 bg-surface-1 p-2 font-mono text-[11px] leading-4 text-text-1 outline-none focus:border-accent/50" />
              ) : (
                <input value={rule.message} onChange={(event) => updateRule(rule.id, { message: event.target.value })} placeholder="Error message, e.g. user {{request.id}} not found" aria-label="Error message" className={cn(fieldClass, 'w-full font-mono')} />
              )}
            </div>
          ))}
        </div>
      </SectionBlock>

      {running && (
        <SectionBlock title="Hits" right={<MiniButton onClick={() => void clearGrpcMockHits().then(poll)} disabled={!status?.hits.length}><Trash2 size={12} /> Clear</MiniButton>}>
          {!status?.hits.length && <p className="text-[11px] text-text-4">No call yet: point a client at {address}.</p>}
          <ul className="flex flex-col gap-1 font-mono text-[10.5px]">
            {[...(status?.hits ?? [])].reverse().slice(0, 50).map((hit) => (
              <li key={`${hit.timestamp}-${hit.method}-${hit.request}`} className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2" title={`${hit.request}\n→ ${hit.response}`}>
                <span className="text-text-4">{new Date(hit.timestamp).toLocaleTimeString('en-GB', { hour12: false })}</span>
                <span className="truncate text-text-2">{hit.method.split('.').pop()} <span className="text-text-4">{hit.rule_name ? `· ${hit.rule_name}` : '· no rule'}</span></span>
                <span className={hit.status === 'OK' ? 'text-success' : 'text-error'}>{hit.status}</span>
              </li>
            ))}
          </ul>
        </SectionBlock>
      )}
    </>
  )
}
