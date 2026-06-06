import { X } from 'lucide-react'
import { useState } from 'react'
import type { RunEntry, RuntimeByNode } from '@/lib/flowRunner'
import type { FlowNodeDefinition } from '@/lib/flowStorage'
import type { RequestItem } from '@/lib/types'
import { KVEditor } from '@/components/composer/KVEditor'
import { cn } from '@/lib/utils'

type DrawerTab = 'request' | 'response' | 'conditions'

interface FlowInspectorDrawerProps {
  node: FlowNodeDefinition
  runtime?: RuntimeByNode[string]
  lastEntry?: RunEntry
  onClose: () => void
  onUpdateRequest: (nodeId: string, request: RequestItem) => void
  onUpdateCondition: (nodeId: string, edgeId: string, expression: string) => void
  edges: Array<{ id: string; label: string; branch: string; condition?: string }>
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export function FlowInspectorDrawer({
  node,
  runtime,
  lastEntry,
  onClose,
  onUpdateRequest,
  onUpdateCondition,
  edges,
}: FlowInspectorDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('request')
  const request = node.config.request

  function handleMethodChange(method: string) {
    if (!request) return
    onUpdateRequest(node.id, { ...request, method: method as RequestItem['method'] })
  }

  function handleUrlChange(url: string) {
    if (!request) return
    onUpdateRequest(node.id, { ...request, url })
  }

  const bodyRaw = request?.bodies?.[request.activeBodyIdx ?? 0]?.raw ?? ''

  function handleBodyChange(raw: string) {
    if (!request) return
    const bodies = request.bodies.map((b, i) =>
      i === (request.activeBodyIdx ?? 0) ? { ...b, raw, type: 'raw' as const } : b,
    )
    onUpdateRequest(node.id, { ...request, bodies })
  }

  const showBody = ['POST', 'PUT', 'PATCH'].includes(request?.method ?? '')

  return (
    <div className="w-[300px] flex-shrink-0 border-l border-border-1 bg-surface-0 flex flex-col overflow-hidden">
      {/* Drawer header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <span className="text-[11px] font-semibold text-text-1 flex-1 truncate">{node.label}</span>
        <span className="text-[9px] text-text-4 bg-surface-2 px-1.5 py-0.5 rounded">{node.type}</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Status strip */}
      {runtime && runtime.status !== 'pending' && (
        <div className={cn(
          'px-3 py-1 text-[10px] font-medium flex items-center gap-2',
          runtime.status === 'success' ? 'bg-success/10 text-success' :
          runtime.status === 'failed' ? 'bg-error/10 text-error' :
          runtime.status === 'running' ? 'bg-accent/10 text-accent' :
          'bg-surface-2 text-text-4',
        )}>
          <span className="capitalize">{runtime.status}</span>
          {runtime.durationMs !== undefined && (
            <span className="text-text-4">{Math.round(runtime.durationMs)}ms</span>
          )}
          {runtime.message && <span className="truncate">{runtime.message}</span>}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-border-1 bg-surface-1 flex-shrink-0">
        {(['request', 'response', 'conditions'] as DrawerTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-1.5 text-[10px] capitalize transition-colors',
              tab === t
                ? 'text-accent border-b-2 border-accent bg-surface-0'
                : 'text-text-4 hover:text-text-2',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'request' && (
          <div className="flex flex-col gap-3">
            {node.type !== 'request' ? (
              <p className="text-[10px] text-text-4">This node type has no request configuration.</p>
            ) : !request ? (
              <p className="text-[10px] text-text-4">No request configured. The node will use a request from your collections when matched by label.</p>
            ) : (
              <>
                {/* Method + URL */}
                <div className="flex gap-1.5">
                  <select
                    value={request.method || 'GET'}
                    onChange={(e) => handleMethodChange(e.target.value)}
                    className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 focus:border-accent outline-none shrink-0"
                  >
                    {HTTP_METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    value={request.url || ''}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://api.example.com/path"
                    className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 focus:border-accent outline-none font-mono"
                  />
                </div>

                {/* Headers */}
                <div>
                  <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Headers</div>
                  <KVEditor
                    rows={request.headers ?? []}
                    onChange={(headers) => onUpdateRequest(node.id, { ...request, headers })}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                  />
                </div>

                {/* Body */}
                {showBody && (
                  <div>
                    <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Body</div>
                    <textarea
                      value={bodyRaw}
                      onChange={(e) => handleBodyChange(e.target.value)}
                      rows={6}
                      className="w-full bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 p-2 focus:border-accent outline-none resize-y"
                      placeholder='{"key": "value"}'
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'response' && (
          <div className="flex flex-col gap-2">
            {!lastEntry ? (
              <p className="text-[10px] text-text-4">No run data yet. Run the flow to see the response.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-[10px] font-semibold px-2 py-0.5 rounded',
                    lastEntry.status === 'success' ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
                  )}>
                    {lastEntry.status}
                  </span>
                  {lastEntry.httpStatus !== undefined && (
                    <span className="text-[10px] text-text-3">HTTP {lastEntry.httpStatus}</span>
                  )}
                  <span className="text-[10px] text-text-4">{Math.round(lastEntry.durationMs)}ms</span>
                </div>
                {lastEntry.response?.body && (
                  <div>
                    <div className="text-[9px] text-text-4 uppercase tracking-wide mb-1.5">Body</div>
                    <pre className="text-[9px] font-mono text-text-2 bg-surface-2 border border-border-2 rounded p-2 overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
                      {lastEntry.response.body}
                    </pre>
                  </div>
                )}
                {lastEntry.error && (
                  <div className="text-[10px] text-error bg-error/10 rounded p-2">{lastEntry.error}</div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'conditions' && (
          <div className="flex flex-col gap-2">
            {edges.length === 0 ? (
              <p className="text-[10px] text-text-4">No outgoing edges from this node.</p>
            ) : (
              edges.map((edge) => (
                <div key={edge.id} className="flex flex-col gap-1">
                  <div className="text-[9px] text-text-4 uppercase tracking-wide">
                    Edge: {edge.label || edge.branch || edge.id}
                  </div>
                  <input
                    value={edge.condition ?? ''}
                    onChange={(e) => onUpdateCondition(node.id, edge.id, e.target.value)}
                    placeholder="status == 200 or $.data != null"
                    className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-[10px] font-mono text-text-1 focus:border-accent outline-none w-full"
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
