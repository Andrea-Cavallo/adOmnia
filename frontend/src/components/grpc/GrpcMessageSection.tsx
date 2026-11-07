/**
 * The request message of a gRPC call: saved messages (body variants) in the JSON editor, an example built from
 * the schema, the fields of the input type, and Send / Close send while a client or bidi stream is open.
 */
import { useState } from 'react'
import { ListTree, Plus, Send, Sparkles, StopCircle, Trash2 } from 'lucide-react'
import { BodyEditor } from '@/components/composer/BodyEditor'
import type { RequestBody, RequestItem } from '@/lib/types'
import { activeGrpcMessage, grpcMessage, grpcSettings } from '@/lib/grpc/grpcRequest'
import { findMethod, rpcKind, sampleRequest, type GrpcFieldInfo } from '@/lib/grpc/grpcSchema'
import { grpcDescriptorsOf, useGrpcDescriptors } from '@/stores/grpcDescriptors'
import { idleStream, useGrpcStreams } from '@/stores/grpcStreams'
import { MiniButton } from '@/components/websocket/wsUi'

const IDLE_SCHEMA = grpcDescriptorsOf('')
const IDLE_STREAM = idleStream()

function fieldType(field: GrpcFieldInfo): string {
  if (field.map) return `map<${field.key_type ?? '?'}, ${field.value_type ?? '?'}>`
  const base = field.enum_type ?? field.message_type ?? field.kind ?? field.type
  return `${field.repeated ? 'repeated ' : ''}${base.split('.').pop() ?? base}`
}

function FieldReference({ fields }: { fields: GrpcFieldInfo[] }) {
  if (!fields.length) return <p className="px-3 py-2 text-[11px] text-text-4">The input message has no fields.</p>
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 font-mono text-[11px]">
      {fields.map((field) => (
        <li key={field.name} className="contents" title={field.description || undefined}>
          <span className="truncate text-text-1">{field.name}</span>
          <span className="truncate text-text-3">{fieldType(field)}{field.enum_values?.length ? ` (${field.enum_values.map((value) => value.name).join(' | ')})` : ''}</span>
          <span className="text-text-4">#{field.number}</span>
        </li>
      ))}
    </ul>
  )
}

export function GrpcMessageSection({ tabId, request, vars, onChange }: { tabId: string; request: RequestItem; vars: Record<string, string>; onChange: (request: RequestItem) => void }) {
  const settings = grpcSettings(request)
  const schema = useGrpcDescriptors((state) => state.byTab[tabId]) ?? IDLE_SCHEMA
  const stream = useGrpcStreams((state) => state.byTab[tabId]) ?? IDLE_STREAM
  const send = useGrpcStreams((state) => state.send)
  const closeSend = useGrpcStreams((state) => state.closeSend)
  const [showFields, setShowFields] = useState(false)
  const [error, setError] = useState('')
  const bodies = request.bodies ?? []
  const message = activeGrpcMessage(request)
  const index = message ? bodies.indexOf(message) : 0
  const method = findMethod(schema.descriptors, settings.service, settings.method)
  const kind = settings.kind ?? rpcKind(method)
  const fields = method ? schema.descriptors?.schemas?.[method.input_type] ?? [] : []
  const streamOpen = !!stream.sessionId

  const edit = (updated: RequestBody) => onChange({ ...request, bodies: bodies.map((body, position) => (position === index ? { ...body, ...updated } : body)), activeBodyIdx: index })
  const add = () => onChange({ ...request, bodies: [...bodies, grpcMessage(`Message ${bodies.length + 1}`, message?.raw ?? '{}')], activeBodyIdx: bodies.length })
  const remove = () => {
    if (bodies.length > 1) onChange({ ...request, bodies: bodies.filter((_, position) => position !== index), activeBodyIdx: Math.max(0, index - 1) })
  }
  const fillExample = () => { if (message) edit({ ...message, raw: sampleRequest(schema.descriptors, method) }) }
  const sendNext = async () => {
    setError((await send(tabId, message?.raw ?? '{}', vars)) ?? '')
  }

  if (!message) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <MiniButton onClick={() => onChange({ ...request, bodies: [grpcMessage('Message 1', '{}')], activeBodyIdx: 0 })}><Plus size={12} /> Add a message</MiniButton>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BodyEditor
        key={message.id}
        body={message}
        isWebSocket
        requestUrl={request.url}
        onChange={edit}
        variantControls={(
          <div className="flex shrink-0 items-center gap-1">
            <select
              value={index}
              onChange={(event) => onChange({ ...request, activeBodyIdx: Number(event.target.value) })}
              aria-label="Saved message"
              className="h-7 min-w-[110px] max-w-[190px] rounded-md border border-border-2 bg-surface-2 pl-2 pr-6 text-[11px] font-medium text-text-1 outline-none hover:border-accent/50 focus:border-accent"
            >
              {bodies.map((body, position) => <option key={body.id} value={position}>{body.name}</option>)}
            </select>
            <button type="button" onClick={add} title="Save a new message" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-2 bg-surface-2 px-2 text-[10.5px] font-medium text-text-2 hover:border-accent/60 hover:text-text-1">
              <Plus size={11} className="text-accent" /> Message
            </button>
            {bodies.length > 1 && <button type="button" onClick={remove} title="Delete this message" aria-label="Delete this message" className="grid h-7 w-7 place-items-center rounded-md text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={12} /></button>}
          </div>
        )}
      />
      {showFields && (
        <div className="max-h-[40%] shrink-0 overflow-auto border-t border-border-1 bg-surface-0">
          <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">{method?.input_type ?? 'Input message'}</div>
          <FieldReference fields={fields} />
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-1 bg-surface-1 px-3 py-2">
        <input
          value={message.name}
          onChange={(event) => edit({ ...message, name: event.target.value })}
          aria-label="Message name"
          className="h-7 w-36 min-w-0 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent/50"
        />
        <MiniButton onClick={fillExample} disabled={!method} title={method ? 'Replace the message with an example built from the schema' : 'Load the services to know the message type'}><Sparkles size={12} /> Example</MiniButton>
        <MiniButton active={showFields} onClick={() => setShowFields((value) => !value)} disabled={!method} title="The fields of the input message"><ListTree size={12} /> Fields</MiniButton>
        {(kind === 'client' || kind === 'bidi') && <span className="text-[10.5px] text-text-4">A JSON array sends several messages.</span>}
        {error && <span className="min-w-0 truncate text-[11px] text-error" title={error}>{error}</span>}
        {streamOpen && (
          <span className="ml-auto flex items-center gap-1.5">
            <MiniButton onClick={() => void closeSend(tabId)} title="End the sending side: the server answers and closes"><StopCircle size={12} /> Close send</MiniButton>
            <button type="button" onClick={() => void sendNext()} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover">
              <Send size={12} /> Send
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
