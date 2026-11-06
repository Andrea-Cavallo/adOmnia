/**
 * The left half of a WebSocket tab, the twin of the REST composer: one row of sections over the
 * saved messages, params, headers, auth and the connection's own settings, script, mock and
 * parallel send.
 */
import { useState } from 'react'
import { AlertTriangle, Code2, Plus, Send, Trash2, Users, X, Zap } from 'lucide-react'
import { AuthEditor } from '@/components/composer/AuthEditor'
import { BodyEditor } from '@/components/composer/BodyEditor'
import { KVEditor } from '@/components/composer/KVEditor'
import { ParamsSection } from '@/components/composer/Composer'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { blankAuth, type RequestBody, type RequestItem, type WebSocketSettings } from '@/lib/types'
import { activeMessage, messageMode, wsAuthSupport, wsMessage, wsSettings } from '@/lib/websocket/wsRequest'
import { MAX_EXTRA_CLIENTS, MAX_PARALLEL_COPIES, emptyConnection, splitCommands, useWsConnections } from '@/stores/websocketConnections'
import { WsMockServer } from './WsMockServer'
import { MiniButton, NumberField, SectionBlock, Toggle } from './wsUi'

type WsSection = 'message' | 'params' | 'headers' | 'auth' | 'settings' | 'script' | 'mock' | 'parallel'
const PRIMARY_SECTIONS: WsSection[] = ['message', 'params', 'headers', 'auth', 'settings']
const IDLE = emptyConnection()
const MAX_RECONNECT_DELAY_S = 120
const PARALLEL_EXAMPLE = '{"type":"subscribe","room":"load-test","n":{{$i}}}\n---\n{"type":"ping","n":{{$i}}}'

const countRows = (rows: RequestItem['headers']) => (rows ?? []).filter((row) => row.enabled && row.key.trim()).length

export interface WebSocketComposerProps {
  tabId: string
  request: RequestItem
  vars: Record<string, string>
  onChange: (request: RequestItem) => void
  /** Sends the active saved message; resolves to an error to show, or null. */
  onSend: () => Promise<string | null>
}

export function WebSocketComposer({ tabId, request, vars, onChange, onSend }: WebSocketComposerProps) {
  const tr = useUiTranslation()
  const [section, setSection] = useState<WsSection>('message')
  const settings = wsSettings(request)
  const setSettings = (patch: Partial<WebSocketSettings>) => onChange({ ...request, ws: { ...settings, ...patch } })
  const auth = request.auth ?? blankAuth()

  const sections: Array<{ id: WsSection; label: string; count: number }> = [
    { id: 'message', label: tr('Message'), count: request.bodies?.length ?? 0 },
    { id: 'params', label: tr('Params'), count: countRows(request.params) },
    { id: 'headers', label: tr('Headers'), count: countRows(request.headers) },
    { id: 'auth', label: tr('Auth'), count: auth.type === 'none' ? 0 : 1 },
    { id: 'settings', label: tr('Settings'), count: (settings.autoReconnect ? 1 : 0) + (settings.subprotocols.trim() ? 1 : 0) },
    { id: 'script', label: tr('Scripts'), count: settings.onMessageScript?.trim() ? 1 : 0 },
    { id: 'mock', label: 'Mock', count: 0 },
    { id: 'parallel', label: 'Parallel', count: 0 },
  ]

  return (
    <div data-ws-composer className="flex min-h-0 flex-1 flex-col border-b border-border-1">
      <div className="api-section-strip flex items-stretch border-b border-border-1">
        <div role="tablist" aria-label={'Connection sections'} className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.filter((item) => PRIMARY_SECTIONS.includes(item.id)).map((item) => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                onClick={() => setSection(item.id)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  active ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1',
                )}
              >
                <span>{item.label}</span>
                {item.count > 0 && (
                  <span className={cn('inline-flex min-w-4 items-center justify-center rounded px-1 py-px font-mono text-[9px] font-semibold', active ? 'bg-accent/25 text-accent-light' : 'bg-surface-3 text-text-2')}>{item.count}</span>
                )}
              </button>
            )
          })}
        </div>
        <select
          aria-label={tr('More')}
          className="api-section-more"
          value={PRIMARY_SECTIONS.includes(section) ? '' : section}
          onChange={(event) => { if (event.target.value) setSection(event.target.value as WsSection) }}
        >
          <option value="" disabled>{tr('More')}</option>
          {sections.filter((item) => !PRIMARY_SECTIONS.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}{item.count ? ` · ${item.count}` : ''}</option>)}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {section === 'message' && <MessageSection tabId={tabId} request={request} onChange={onChange} onSend={onSend} />}
        {section === 'params' && <ParamsSection request={request} onChange={onChange} />}
        {section === 'headers' && (
          <KVEditor headerMode rows={request.headers ?? []} onChange={(headers) => onChange({ ...request, headers })} keyPlaceholder={tr('Header name')} valuePlaceholder={tr('Header value')} />
        )}
        {section === 'auth' && (
          <>
            <AuthNotice support={wsAuthSupport(auth)} />
            <AuthEditor auth={auth} onChange={(next) => onChange({ ...request, auth: next })} />
          </>
        )}
        {section === 'settings' && <SettingsSection settings={settings} onChange={setSettings} />}
        {section === 'script' && (
          <SectionBlock title="On message" hint={<>Runs locally, in a sandbox, for every inbound message. The frame is <code className="text-accent">msg</code> (<code>content</code>, <code>timestamp</code>, <code>binary</code>); a returned value shows up in the stream.</>}>
            <textarea
              value={settings.onMessageScript ?? ''}
              onChange={(event) => setSettings({ onMessageScript: event.target.value })}
              placeholder={'// e.g. count trades\nconst data = JSON.parse(msg.content)\nreturn data.type === "trade" ? `trade ${data.price}` : undefined'}
              rows={10}
              spellCheck={false}
              className="w-full resize-y rounded border border-border-2 bg-surface-0 p-2 font-mono text-[11.5px] leading-5 text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
            />
          </SectionBlock>
        )}
        {section === 'mock' && (
          <SectionBlock title="Mock server" hint="A local WebSocket server that answers incoming messages by rule. Start it, then connect this tab to it.">
            <WsMockServer
              onConnectToMock={(url) => onChange({ ...request, url })}
              onSystem={() => undefined}
            />
          </SectionBlock>
        )}
        {section === 'parallel' && <ParallelSection tabId={tabId} request={request} vars={vars} onChange={onChange} />}
      </div>
    </div>
  )
}

function AuthNotice({ support }: { support: ReturnType<typeof wsAuthSupport> }) {
  if (support === 'none' || support === 'native') return null
  const text = support === 'header'
    ? 'The API key travels as a header of the handshake.'
    : 'This auth type needs a request/response exchange the WebSocket handshake does not have, so the connection opens without it. Use Bearer, Basic, API Key or an OAuth 2.0 token.'
  return (
    <div className={cn('mx-3 mt-3 flex items-start gap-2 rounded border px-3 py-2 text-[11px] leading-relaxed', support === 'header' ? 'border-info/30 bg-info/10 text-text-2' : 'border-warning/30 bg-warning/10 text-warning')}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

/** The saved messages of the connection (its body variants), the editor and Send. */
function MessageSection({ tabId, request, onChange, onSend }: Omit<WebSocketComposerProps, 'vars'>) {
  const tr = useUiTranslation()
  const connected = (useWsConnections((state) => state.connections[tabId]) ?? IDLE).status === 'connected'
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const bodies = request.bodies ?? []
  const message = activeMessage(request)
  const index = message ? bodies.indexOf(message) : 0
  const binary = wsSettings(request).payloadMode === 'binary'

  const select = (next: number) => onChange({ ...request, activeBodyIdx: next })
  const add = () => onChange({ ...request, bodies: [...bodies, wsMessage(`Message ${bodies.length + 1}`, message?.raw ?? '', message?.lang ?? 'json')], activeBodyIdx: bodies.length })
  const remove = () => {
    if (bodies.length <= 1) return
    onChange({ ...request, bodies: bodies.filter((_, position) => position !== index), activeBodyIdx: Math.max(0, index - 1) })
  }
  const edit = (updated: RequestBody) => onChange({ ...request, bodies: bodies.map((body, position) => (position === index ? { ...body, ...updated } : body)), activeBodyIdx: index })

  const send = async () => {
    setSending(true)
    const failure = await onSend()
    setSending(false)
    setError(failure ?? '')
  }

  if (!message) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <MiniButton onClick={() => onChange({ ...request, bodies: [wsMessage('Message 1', '')], activeBodyIdx: 0 })}><Plus size={12} /> Add a message</MiniButton>
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
              onChange={(event) => select(Number(event.target.value))}
              aria-label="Saved message"
              title="Saved messages of this connection"
              className="h-7 min-w-[110px] max-w-[190px] rounded-md border border-border-2 bg-surface-2 pl-2 pr-6 text-[11px] font-medium text-text-1 outline-none hover:border-accent/50 focus:border-accent"
            >
              {bodies.map((body, position) => <option key={body.id} value={position}>{body.name}</option>)}
            </select>
            <button type="button" onClick={add} title="Save a new message" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-2 bg-surface-2 px-2 text-[10.5px] font-medium text-text-2 hover:border-accent/60 hover:text-text-1">
              <Plus size={11} className="text-accent" /> {tr('Message')}
            </button>
            {bodies.length > 1 && (
              <button type="button" onClick={remove} title="Delete this message" aria-label="Delete this message" className="grid h-7 w-7 place-items-center rounded-md text-text-4 hover:bg-error/10 hover:text-error"><Trash2 size={12} /></button>
            )}
          </div>
        )}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-1 bg-surface-1 px-3 py-2">
        <input
          value={message.name}
          onChange={(event) => edit({ ...message, name: event.target.value })}
          aria-label="Message name"
          className="h-7 w-40 min-w-0 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent/50"
        />
        <Toggle checked={binary} onChange={(checked) => onChange({ ...request, ws: { ...wsSettings(request), payloadMode: checked ? 'binary' : 'json' } })} label="Binary (Base64)" />
        {error && <span className="min-w-0 truncate text-[11px] text-error" title={error}>{error}</span>}
        <span className="ml-auto hidden text-[10.5px] text-text-4 sm:inline">Ctrl+Enter</span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !request.url.trim()}
          title={connected ? `Send as ${messageMode(request, message).toUpperCase()}` : 'Open the connection, then send with Ctrl+Enter'}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Send size={12} /> {connected ? tr('Send') : tr('Connect')}
        </button>
      </div>
    </div>
  )
}

function SettingsSection({ settings, onChange }: { settings: WebSocketSettings; onChange: (patch: Partial<WebSocketSettings>) => void }) {
  return (
    <>
      <SectionBlock title="Subprotocols" hint="Sent as Sec-WebSocket-Protocol, comma separated.">
        <input
          value={settings.subprotocols}
          onChange={(event) => onChange({ subprotocols: event.target.value })}
          placeholder="graphql-ws, mqtt, v12.stomp"
          className="h-8 w-full rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11.5px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
        />
      </SectionBlock>
      <SectionBlock title="Reconnect" hint="When the server closes the connection, open it again (at most 10 attempts).">
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={settings.autoReconnect} onChange={(autoReconnect) => onChange({ autoReconnect })} label="Auto-reconnect" />
          <NumberField label="Delay" value={settings.reconnectDelay} max={MAX_RECONNECT_DELAY_S} onChange={(reconnectDelay) => onChange({ reconnectDelay })} suffix="s" />
        </div>
      </SectionBlock>
    </>
  )
}

/** Every command, N copies each, at once on the main connection and every extra client. */
function ParallelSection({ tabId, request, vars, onChange }: Omit<WebSocketComposerProps, 'onSend'>) {
  const connection = useWsConnections((state) => state.connections[tabId]) ?? IDLE
  const openExtraClients = useWsConnections((state) => state.openExtraClients)
  const closeExtraClients = useWsConnections((state) => state.closeExtraClients)
  const sendParallel = useWsConnections((state) => state.sendParallel)
  const settings = wsSettings(request)
  const [draft, setDraft] = useState(() => activeMessage(request)?.raw ?? '')
  const copies = settings.parallelCopies ?? 2
  const newClients = settings.parallelClients ?? 2
  const connected = connection.status === 'connected'
  const commands = splitCommands(draft)
  const clientCount = 1 + connection.extraClients.length
  const total = commands.length * copies * clientCount
  const setSettings = (patch: Partial<WebSocketSettings>) => onChange({ ...request, ws: { ...settings, ...patch } })

  return (
    <SectionBlock
      title="Parallel send"
      hint={<>Separate commands with a line holding only <code>---</code>. <code className="text-accent">{'{{$i}}'}</code> becomes the send index.</>}
      right={<MiniButton onClick={() => setDraft(PARALLEL_EXAMPLE)}><Code2 size={12} /> Example</MiniButton>}
    >
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={8}
        spellCheck={false}
        className="mb-3 w-full resize-y rounded border border-border-2 bg-surface-0 p-2 font-mono text-[11.5px] leading-5 text-text-1 outline-none focus:border-accent/50"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <NumberField label="Copies per command" value={copies} max={MAX_PARALLEL_COPIES} onChange={(parallelCopies) => setSettings({ parallelCopies })} />
        <span className="flex items-center gap-2 text-[11.5px] text-text-3">Clients <span className="rounded bg-surface-3 px-2 py-0.5 font-mono text-text-1">{clientCount}</span></span>
        <NumberField label="Add" value={newClients} max={MAX_EXTRA_CLIENTS} onChange={(parallelClients) => setSettings({ parallelClients })} />
        <MiniButton onClick={() => void openExtraClients(tabId, newClients)} disabled={!connected}><Users size={12} /> Open {newClients} more</MiniButton>
        {clientCount > 1 && <MiniButton onClick={() => void closeExtraClients(tabId)}><X size={12} /> Close extra</MiniButton>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-text-2">
          {commands.length === 0 ? 'Write at least one command.' : <>Sends <b className="text-text-1">{total} messages</b>: {commands.length} × {copies} × {clientCount} client{clientCount === 1 ? '' : 's'}.</>}
        </span>
        <button
          type="button"
          onClick={() => void sendParallel(tabId, commands, copies, messageMode(request, activeMessage(request)), vars)}
          disabled={!connected || total === 0}
          title={connected ? undefined : 'Connect first'}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Zap size={12} /> {connected ? `Send ${total}` : 'Connect to send'}
        </button>
      </div>
    </SectionBlock>
  )
}
