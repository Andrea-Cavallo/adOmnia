/**
 * The top bar of a WebSocket tab, the twin of the REST request bar: protocol, URL with variables,
 * actions, and Connect/Disconnect where REST has Send.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, MoreHorizontal, Plug, Save, Trash2, Unplug } from 'lucide-react'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { requestWithUrlInput, resolvedRequestUrl } from '@/lib/requestUrl'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import type { HttpMethod, RequestItem } from '@/lib/types'
import { connectPayload, wsScheme } from '@/lib/websocket/wsRequest'
import { emptyConnection, useWsConnections } from '@/stores/websocketConnections'
import { LiveWebSocketHandler } from './LiveWebSocketHandler'

const IDLE = emptyConnection()
const SAVED_FLASH_MS = 1000
/** WS first; the HTTP methods turn the tab back into a REST request. */
const PROTOCOLS: HttpMethod[] = ['WS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function WebSocketRequestBar({ tabId, request, isDirty, vars, hasActiveEnv, onChange, onSave, onDelete }: {
  tabId: string
  request: RequestItem
  isDirty: boolean
  vars: Record<string, string>
  hasActiveEnv: boolean
  onChange: (request: RequestItem) => void
  onSave: () => void
  onDelete: () => void
}) {
  const tr = useUiTranslation()
  const connection = useWsConnections((state) => state.connections[tabId]) ?? IDLE
  const connect = useWsConnections((state) => state.connect)
  const disconnect = useWsConnections((state) => state.disconnect)
  const [savedFlash, setSavedFlash] = useState(false)
  const actionsRef = useRef<HTMLDetailsElement>(null)

  const busy = connection.status === 'connecting' || connection.status === 'reconnecting'
  const open = connection.status === 'connected' || busy
  const url = resolvedRequestUrl(request)
  const scheme = wsScheme(url)

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = actionsRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const toggle = () => {
    if (open) void disconnect(tabId)
    else if (request.url.trim()) void connect(tabId, request, vars)
  }

  const save = () => {
    onSave()
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
  }

  return (
    <div className="api-request-bar border-b border-border-1">
      <div className="api-request-caption">
        <span className="api-dot-label">{tr('Connection')}</span>
        <span className="truncate">{request.name}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <select
          value={request.method}
          onChange={(event) => onChange({ ...request, method: event.target.value as HttpMethod })}
          disabled={open}
          title={open ? 'Disconnect to change the protocol' : 'Protocol'}
          aria-label={'Protocol'}
          className="api-method h-[var(--ui-control-h)] w-[90px] rounded-md border border-border-2 bg-surface-2 px-2 font-mono text-[12px] font-bold text-info outline-none transition-colors focus:border-accent disabled:opacity-80"
        >
          {PROTOCOLS.map((method) => <option key={method} value={method}>{method === 'WS' ? scheme : method}</option>)}
        </select>

        <div className="api-url h-[var(--ui-control-h)] min-w-0 flex-1 overflow-hidden rounded-md border border-border-2 bg-surface-2 transition-colors focus-within:border-accent">
          <VarHighlightInput
            value={url}
            onChange={(next) => onChange(requestWithUrlInput(request, next))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return
              event.preventDefault()
              event.stopPropagation()
              if (!open) toggle()
            }}
            resolvedVars={vars}
            hasActiveEnv={hasActiveEnv}
            placeholder="wss://echo.websocket.org or {{ws_url}}/socket"
            className="h-full"
          />
        </div>

        <details ref={actionsRef} className="api-actions">
          <summary aria-label={'Connection actions'} title={'Connection actions'}><MoreHorizontal size={18} /></summary>
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
            <button type="button" onClick={onDelete} title={'Delete connection'} className="grid h-[var(--ui-control-h)] w-[var(--ui-control-h)] place-items-center rounded-md text-text-3 transition-colors hover:bg-error/10 hover:text-error">
              <Trash2 size={14} />
              <span>{'Delete connection'}</span>
            </button>
          </div>
        </details>

        {isDirty && <button type="button" onClick={save} title={tr('Save to collection (Ctrl+S)')} aria-label={tr('Save to collection (Ctrl+S)')} className="api-quick-save"><Save size={15} /><span className="api-dirty-dot" /></button>}

        <button
          type="button"
          onClick={toggle}
          disabled={!open && !request.url.trim()}
          title={open ? 'Close the connection' : 'Open the connection (Enter)'}
          aria-busy={busy}
          data-ws-connect={open ? 'disconnect' : 'connect'}
          className={cn('api-send-action api-send-nothing flex h-[var(--ui-control-h)] min-w-[132px] items-center justify-center gap-2 px-5 disabled:cursor-not-allowed disabled:opacity-40', open && 'is-ws-open')}
        >
          <span className="api-send-icon" aria-hidden="true">{open ? <Unplug size={14} strokeWidth={2.25} /> : <Plug size={14} strokeWidth={2.25} />}</span>
          <span className="api-send-label">{open ? tr('Disconnect') : tr('Connect')}</span>
          <span className="api-send-status" data-running={busy || connection.status === 'connected'} aria-hidden="true" />
        </button>
      </div>
      <LiveWebSocketHandler url={connectPayload(request, vars).url} connected={connection.status === 'connected'} onDebugReady={() => void connect(tabId, request, vars)} />
    </div>
  )
}
