import { useCallback, useEffect, useState } from 'react'
import { Terminal, Cpu, Zap, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePluginsStore } from '@/stores/plugins'
import {
  getHostFunctions,
  getAvailableEvents,
  getSandboxStatus,
  getPlugins,
  executePlugin,
  type SandboxStatus,
} from '@/lib/plugins-api'

export function PluginDevTools({ embedded = false }: { embedded?: boolean }) {
  const { plugins, setPlugins } = usePluginsStore()
  const [hostFunctions, setHostFunctions] = useState<string[]>([])
  const [events, setEvents] = useState<string[]>([])
  const [sandboxStatuses, setSandboxStatuses] = useState<Record<string, SandboxStatus>>({})
  const [selectedPluginId, setSelectedPluginId] = useState('')
  const [functionName, setFunctionName] = useState('')
  const [argsJson, setArgsJson] = useState('{}')
  const [execResult, setExecResult] = useState<string | null>(null)
  const [execError, setExecError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const [fns, evts, pluginList] = await Promise.all([
      getHostFunctions(),
      getAvailableEvents(),
      getPlugins(),
    ])
    setHostFunctions(fns)
    setEvents(evts)
    setPlugins(pluginList)

    const statuses: Record<string, SandboxStatus> = {}
    for (const p of pluginList) {
      const status = await getSandboxStatus(p.manifest.id)
      if (status) {
        statuses[p.manifest.id] = status
      }
    }
    setSandboxStatuses(statuses)
  }, [setPlugins])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleExecute = async () => {
    setExecResult(null)
    setExecError(null)

    if (!selectedPluginId || !functionName.trim()) {
      setExecError('Select a plugin and enter a function name.')
      return
    }

    let args: Record<string, unknown>
    try {
      const parsed = JSON.parse(argsJson)
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Arguments must be a JSON object.')
      }
      args = parsed as Record<string, unknown>
    } catch {
      setExecError('Invalid JSON in args field.')
      return
    }

    try {
      const result = await executePlugin(selectedPluginId, functionName.trim(), args)
      setExecResult(JSON.stringify(result, null, 2))
      const status = await getSandboxStatus(selectedPluginId)
      if (status) setSandboxStatuses((current) => ({ ...current, [selectedPluginId]: status }))
    } catch (error) {
      setExecError(error instanceof Error ? error.message : 'Plugin execution failed.')
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      {!embedded && (
        <header className="flex items-center gap-3 px-6 py-4 border-b border-border-1 flex-shrink-0">
          <Terminal size={16} className="text-accent" />
          <div>
            <h1 className="text-lg font-semibold text-text-1">Plugin Dev Tools</h1>
            <p className="text-xs text-text-3 mt-0.5">Inspect runtime, test functions, and monitor sandboxes</p>
          </div>
        </header>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-md border border-border-1 bg-surface-1 px-4 py-3 text-xs text-text-3">
          Questa vista e dedicata agli autori dei plugin. Per usare un plugin installato, torna a
          <span className="font-medium text-text-1"> Plugin installati</span> e apri il suo pannello azioni.
        </div>
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-accent" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-3">Host Functions</h2>
          </div>
          {hostFunctions.length === 0 ? (
            <p className="text-xs text-text-4 italic">No host functions registered.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
              {hostFunctions.map((fn) => (
                <div
                  key={fn}
                  className="px-2.5 py-1.5 text-xs font-mono text-text-2 bg-surface-1 border border-border-1 rounded"
                >
                  {fn}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-accent" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-3">Hookable Events</h2>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-text-4 italic">No events available.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5">
              {events.map((evt) => (
                <div
                  key={evt}
                  className="px-2.5 py-1.5 text-xs font-mono text-accent/80 bg-accent/5 border border-accent/10 rounded"
                >
                  {evt}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Play size={13} className="text-accent" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-3">Test Execution</h2>
          </div>
          <div className="p-4 rounded-lg bg-surface-1 border border-border-1 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-text-4 uppercase tracking-wider">Plugin</span>
                <select
                  value={selectedPluginId}
                  onChange={(e) => setSelectedPluginId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-surface-2 border border-border-1 rounded text-text-1 focus:outline-none focus:border-accent"
                >
                  <option value="">Select plugin...</option>
                  {plugins.map((p) => (
                    <option key={p.manifest.id} value={p.manifest.id}>
                      {p.manifest.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-text-4 uppercase tracking-wider">Function</span>
                <input
                  value={functionName}
                  onChange={(e) => setFunctionName(e.target.value)}
                  placeholder="functionName"
                  className="w-full px-2 py-1.5 text-xs bg-surface-2 border border-border-1 rounded text-text-1 font-mono focus:outline-none focus:border-accent"
                />
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-[10px] text-text-4 uppercase tracking-wider">Arguments (JSON)</span>
              <textarea
                value={argsJson}
                onChange={(e) => setArgsJson(e.target.value)}
                className="w-full h-20 px-2 py-1.5 text-xs font-mono bg-surface-2 border border-border-1 rounded text-text-1 focus:outline-none focus:border-accent resize-none"
              />
            </label>
            <button
              onClick={handleExecute}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-colors"
            >
              <Play size={11} />
              Execute
            </button>
            {execResult && (
              <div className="px-3 py-2 rounded-md bg-green-500/10 border border-green-500/20">
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{execResult}</pre>
              </div>
            )}
            {execError && (
              <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400">{execError}</p>
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Cpu size={13} className="text-accent" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-text-3">Sandbox Status</h2>
          </div>
          {plugins.length === 0 ? (
            <p className="text-xs text-text-4 italic">No plugins to monitor.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plugins.map((p) => {
                const status = sandboxStatuses[p.manifest.id]
                return (
                  <div
                    key={p.manifest.id}
                    className="px-4 py-3 rounded-lg bg-surface-1 border border-border-1"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-text-1">{p.manifest.name}</span>
                      <span
                        className={cn(
                          'px-1.5 py-0.5 text-[10px] font-medium rounded',
                          status?.running
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-surface-2 text-text-4'
                        )}
                      >
                        {status?.running ? 'Running' : 'Idle'}
                      </span>
                    </div>
                    {status ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-text-4">Memory</span>
                          <span className="text-text-2 font-mono">
                            {formatBytes(status.memory)} / {formatBytes(status.maxMemory)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              status.memory / status.maxMemory > 0.8
                                ? 'bg-red-500'
                                : status.memory / status.maxMemory > 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-accent'
                            )}
                            style={{ width: `${Math.min(100, (status.memory / status.maxMemory) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-text-4 italic">No sandbox data available</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
