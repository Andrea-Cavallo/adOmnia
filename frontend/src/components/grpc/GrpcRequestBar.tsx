/**
 * The top bar of a gRPC tab, the twin of the REST request bar: server address with variables, the
 * service/method to call (from the loaded schema), actions, and Invoke (or Start stream) where REST has Send.
 */
import { useEffect, useRef, useState } from 'react'
import { Code2 } from 'lucide-react'
import { findGrpcHandler, openGrpcHandler, type GrpcHandlerLink } from '@/lib/grpc/grpcCodeLink'
import { Check, ChevronsRight, Lock, MoreHorizontal, RefreshCw, Save, Square, Trash2 } from 'lucide-react'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import type { RequestItem } from '@/lib/types'
import { RPC_KIND_LABEL, findMethod, rpcKind, sampleRequest, serviceShortName, type GrpcRpcKind } from '@/lib/grpc/grpcSchema'
import { activeGrpcMessage, grpcSettings, grpcTarget } from '@/lib/grpc/grpcRequest'
import { grpcDescriptorsOf, useGrpcDescriptors } from '@/stores/grpcDescriptors'
import { idleStream, useGrpcStreams } from '@/stores/grpcStreams'

const SAVED_FLASH_MS = 1000
const IDLE_STREAM = idleStream()
const IDLE_DESCRIPTORS = grpcDescriptorsOf('')

/** True when the message is still the placeholder, so picking a method may replace it with an example. */
const isPlaceholder = (raw: string | undefined) => !raw?.trim() || /^\{\s*\}$/.test(raw.trim()) || /^\[\s*\{\s*\}\s*\]$/.test(raw.trim())

/** Under the bar when an open project implements the rpc: open its Go method, like "Go to handler" for REST. */
function GrpcHandlerStrip({ service, method }: { service: string; method: string }) {
  const [link, setLink] = useState<GrpcHandlerLink | null>(null)
  useEffect(() => {
    let current = true
    void findGrpcHandler(service, method).then((found) => { if (current) setLink(found) }).catch(() => undefined)
    return () => { current = false }
  }, [service, method])
  if (!link) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-3">
      <span>Served by <span className="font-mono text-text-1">{link.name}()</span>{link.language && link.language !== 'go' ? ` · ${link.language[0].toUpperCase()}${link.language.slice(1)}` : ''} · {link.relativePath}:{link.line}</span>
      <button type="button" onClick={() => void openGrpcHandler(link)} className="inline-flex items-center gap-1 rounded border border-border-2 px-2 py-0.5 text-text-2 hover:border-accent hover:text-accent"><Code2 size={11} /> Handler</button>
    </div>
  )
}

export interface GrpcRequestBarProps {
  tabId: string
  request: RequestItem
  isDirty: boolean
  vars: Record<string, string>
  hasActiveEnv: boolean
  /** A unary call in flight. */
  loading: boolean
  onChange: (request: RequestItem) => void
  onInvoke: () => void
  onCancel: () => void
  onSave: () => void
  onDelete: () => void
}

export function GrpcRequestBar({ tabId, request, isDirty, vars, hasActiveEnv, loading, onChange, onInvoke, onCancel, onSave, onDelete }: GrpcRequestBarProps) {
  const tr = useUiTranslation()
  const settings = grpcSettings(request)
  const schema = useGrpcDescriptors((state) => state.byTab[tabId]) ?? IDLE_DESCRIPTORS
  const load = useGrpcDescriptors((state) => state.load)
  const stream = useGrpcStreams((state) => state.byTab[tabId]) ?? IDLE_STREAM
  const [savedFlash, setSavedFlash] = useState(false)
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const target = grpcTarget(request, vars)
  const kind: GrpcRpcKind = settings.kind ?? rpcKind(findMethod(schema.descriptors, settings.service, settings.method))
  const streaming = stream.status === 'running'
  const busy = loading || streaming
  const ready = !!request.url.trim() && !!settings.service && !!settings.method

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = actionsRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  // Schemas on disk are local and cheap: load them as soon as the tab shows. Reflection waits for a click.
  const sourceKey = `${settings.source}:${settings.protoFiles.join('|')}:${settings.importPaths.join('|')}:${settings.protosetPath}:${Object.keys(settings.inlineProtos ?? {}).join('|')}`
  useEffect(() => {
    if (settings.source !== 'reflection' && (settings.protoFiles.length || settings.protosetPath || settings.inlineProtos)) void load(tabId, request, vars)
    // Reload only when the source changes, not on every keystroke elsewhere in the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, tabId])

  const pick = (value: string) => {
    const [service, method] = value.split('\u0000')
    const info = findMethod(schema.descriptors, service, method)
    const nextKind = rpcKind(info)
    const message = activeGrpcMessage(request)
    const bodies = message && isPlaceholder(message.raw)
      ? (request.bodies ?? []).map((body) => (body.id === message.id ? { ...body, raw: sampleRequest(schema.descriptors, info) } : body))
      : request.bodies
    onChange({ ...request, bodies, grpc: { ...settings, service, method, kind: nextKind } })
  }

  const save = () => {
    onSave()
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
  }

  const services = schema.descriptors?.services ?? []
  const selected = settings.service && settings.method ? `${settings.service}\u0000${settings.method}` : ''
  const knownSelection = services.some((service) => service.name === settings.service && service.methods.some((method) => method.name === settings.method))

  return (
    <div className="api-request-bar border-b border-border-1">
      <div className="api-request-caption">
        <span className="api-dot-label">gRPC</span>
        <span className="truncate">{request.name}</span>
        {schema.origin && <span className="hidden truncate text-text-4 md:inline" title="Where the services come from">{schema.origin}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="api-method flex h-[var(--ui-control-h)] w-[90px] shrink-0 items-center justify-center gap-1 rounded-md border border-border-2 bg-surface-2 font-mono text-[12px] font-bold text-method-patch" title={target.tls ? 'gRPC over TLS' : 'gRPC, plaintext'}>
          {target.tls && <Lock size={11} aria-hidden="true" />}gRPC
        </span>

        <div className="api-url h-[var(--ui-control-h)] min-w-[140px] flex-[2] overflow-hidden rounded-md border border-border-2 bg-surface-2 transition-colors focus-within:border-accent">
          <VarHighlightInput
            value={request.url}
            onChange={(url) => onChange({ ...request, url })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return
              event.preventDefault()
              event.stopPropagation()
              if (ready && !busy) onInvoke()
            }}
            resolvedVars={vars}
            hasActiveEnv={hasActiveEnv}
            placeholder="localhost:50051, grpcs://api.example.com or {{grpc_host}}"
            className="h-full"
          />
        </div>

        <div className="flex h-[var(--ui-control-h)] min-w-[160px] flex-[2] items-center overflow-hidden rounded-md border border-border-2 bg-surface-2 focus-within:border-accent">
          <select
            value={selected}
            onChange={(event) => pick(event.target.value)}
            aria-label="gRPC method"
            title={settings.service ? `${settings.service}/${settings.method} · ${RPC_KIND_LABEL[kind]}` : 'Load the services, then pick the method'}
            className="h-full min-w-0 flex-1 truncate bg-transparent pl-2 pr-1 font-mono text-[12px] text-text-1 outline-none"
          >
            {!selected && <option value="">{services.length ? 'Pick a method…' : 'No services loaded'}</option>}
            {selected && !knownSelection && <option value={selected}>{serviceShortName(settings.service)}/{settings.method}</option>}
            {services.map((service) => (
              <optgroup key={service.name} label={service.name}>
                {service.methods.map((method) => (
                  <option key={method.name} value={`${service.name}\u0000${method.name}`}>
                    {serviceShortName(service.name)}/{method.name}{rpcKind(method) === 'unary' ? '' : ` · ${RPC_KIND_LABEL[rpcKind(method)]}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load(tabId, request, vars)}
            disabled={schema.loading || (settings.source === 'reflection' && !request.url.trim())}
            title={settings.source === 'reflection' ? 'Load the services with server reflection' : 'Reload the services from the schema files'}
            aria-label="Load services"
            className="grid h-full w-8 shrink-0 place-items-center border-l border-border-2 text-text-3 transition-colors hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"
          >
            <RefreshCw size={13} className={schema.loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <details ref={actionsRef} className="api-actions">
          <summary aria-label="gRPC call actions" title="gRPC call actions"><MoreHorizontal size={18} /></summary>
          <div className="api-actions-menu" data-a11y-click-exempt role="presentation" onClick={() => { if (actionsRef.current) actionsRef.current.open = false }}>
            <button
              type="button"
              onClick={save}
              title={tr('Save to collection (Ctrl+S)')}
              className={cn('grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md transition-all', savedFlash ? 'bg-success/10 text-success' : isDirty ? 'border border-warning/30 bg-warning/15 text-warning hover:bg-warning/25' : 'text-text-3 hover:bg-surface-2 hover:text-text-1')}
            >
              {savedFlash ? <Check size={15} /> : <Save size={15} />}
              <span>{tr('Save to collection (Ctrl+S)')}</span>
            </button>
            <button type="button" onClick={onDelete} title="Delete this gRPC call" className="grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md text-text-3 transition-colors hover:bg-error/10 hover:text-error">
              <Trash2 size={14} />
              <span>Delete this gRPC call</span>
            </button>
          </div>
        </details>

        {isDirty && <button type="button" onClick={save} title={tr('Save to collection (Ctrl+S)')} aria-label={tr('Save to collection (Ctrl+S)')} className="api-quick-save"><Save size={15} /><span className="api-dirty-dot" /></button>}

        <button
          type="button"
          onClick={busy ? onCancel : onInvoke}
          disabled={!busy && !ready}
          title={busy ? 'Cancel the call' : ready ? `${kind === 'unary' ? 'Invoke' : 'Start the stream'} (Enter, Ctrl+Enter)` : 'Set the address and pick a method'}
          aria-busy={busy}
          data-grpc-invoke={busy ? 'cancel' : kind}
          className="api-send-action api-send-nothing flex h-[var(--ui-control-h)] min-w-[132px] items-center justify-center gap-2 px-5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="api-send-icon" aria-hidden="true">{busy ? <Square size={9} fill="currentColor" /> : <ChevronsRight size={14} strokeWidth={2.25} />}</span>
          <span className="api-send-label">{busy ? (streaming ? 'Stop' : 'Cancel') : kind === 'unary' ? 'Invoke' : 'Stream'}</span>
          <span className="api-send-status" data-running={busy} aria-hidden="true" />
        </button>
      </div>
      {schema.error && <p className="mt-1.5 line-clamp-2 text-[11px] text-error" title={schema.error}>{schema.error}</p>}
      <GrpcHandlerStrip service={settings.service} method={settings.method} />
    </div>
  )
}
