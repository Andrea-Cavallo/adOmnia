import { useState, useCallback } from 'react'
import { Play, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PluginInstance, PluginAction } from '@/stores/plugins'
import { executePluginAction, executePluginActionStream } from '@/lib/python-bridge-api'

interface PluginPanelProps {
  plugin: PluginInstance
}

type ActionStatus = 'idle' | 'running' | 'success' | 'error'

interface ActionState {
  status: ActionStatus
  result: string
  error: string
}

/**
 * PluginPanel renders a dedicated panel for a plugin that declares "panel" in its ui_slots.
 * It shows the plugin name, description, and an "Execute" button per action.
 */
export function PluginPanel({ plugin }: PluginPanelProps) {
  const actions = plugin.manifest.actions ?? []
  const runtime = plugin.manifest.runtime?.toLowerCase() ?? ''
  const isWasm = runtime === 'wasm'
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})

  const updateActionState = (actionId: string, partial: Partial<ActionState>) => {
    setActionStates((prev) => ({
      ...prev,
      [actionId]: { ...(prev[actionId] ?? { status: 'idle', result: '', error: '' }), ...partial },
    }))
  }

  const handleExecute = useCallback(
    async (action: PluginAction) => {
      updateActionState(action.id, { status: 'running', result: '', error: '' })
      try {
        if (action.streaming) {
          await executePluginActionStream(plugin.manifest.id, action.id)
          updateActionState(action.id, { status: 'success', result: 'Stream started successfully' })
        } else {
          const result = await executePluginAction(plugin.manifest.id, action.id)
          updateActionState(action.id, { status: 'success', result })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Execution failed'
        updateActionState(action.id, { status: 'error', error: message })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plugin.manifest.id]
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {isWasm && (
        <div className="flex items-start gap-2 px-4 py-2 border-b border-warning/30 bg-warning/10 flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-warning leading-relaxed">
            Questo plugin WASM non puo ancora eseguire azioni personalizzate. Le integrazioni dichiarate restano visibili.
          </p>
        </div>
      )}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border-1 flex-shrink-0">
        <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-accent">
            {plugin.manifest.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-text-1 truncate">{plugin.manifest.name}</h1>
          <p className="text-xs text-text-3 mt-0.5 truncate">
            {plugin.manifest.description || `by ${plugin.manifest.author}`}
          </p>
        </div>
        <span className="px-2 py-0.5 text-[10px] font-medium bg-accent/10 text-accent rounded">
          v{plugin.manifest.version}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {!isWasm && actions.length > 0 && (
          <div className="mb-4 rounded-md border border-border-1 bg-surface-1 px-3 py-2 text-xs text-text-3">
            Scegli un'azione e premi <span className="font-medium text-text-1">Esegui</span>. Il risultato comparira sotto l'azione.
          </div>
        )}
        {actions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Play size={32} className="text-text-4" />
            <p className="text-sm text-text-3">No actions defined in this plugin.</p>
            <p className="text-xs text-text-4">
              Add an &quot;actions&quot; array to the plugin manifest to define executable actions.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((action) => {
              const state = actionStates[action.id] ?? { status: 'idle', result: '', error: '' }
              return (
                <div
                  key={action.id}
                  className="rounded-lg border border-border-1 bg-surface-1 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-text-1">{action.name}</h4>
                      {action.description && (
                        <p className="text-xs text-text-3 mt-0.5">{action.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-text-4 font-mono">{action.id}</span>
                        {action.streaming && (
                          <span className="px-1.5 py-0.5 text-[9px] font-medium bg-blue-500/10 text-blue-400 rounded">
                            streaming
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleExecute(action)}
                      disabled={state.status === 'running' || isWasm}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                        state.status === 'running'
                          ? 'bg-surface-2 text-text-4 cursor-not-allowed'
                          : 'bg-accent text-white hover:opacity-90'
                      )}
                    >
                      {state.status === 'running' ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Play size={11} />
                      )}
                      {isWasm ? 'Non disponibile' : 'Esegui'}
                    </button>
                  </div>

                  {state.status === 'success' && state.result && (
                    <div className="px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CheckCircle size={11} className="text-green-400" />
                        <span className="text-[10px] font-medium text-green-400">Success</span>
                      </div>
                      <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {state.result}
                      </pre>
                    </div>
                  )}

                  {state.status === 'error' && state.error && (
                    <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20">
                      <div className="flex items-center gap-1.5 mb-1">
                        <AlertTriangle size={11} className="text-red-400" />
                        <span className="text-[10px] font-medium text-red-400">Error</span>
                      </div>
                      <p className="text-xs text-red-300">{state.error}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
