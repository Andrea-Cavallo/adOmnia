import { useState } from 'react'
import { AlertCircle, CheckCircle2, Plug, PlugZap, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
import { useMcpStore, type McpPrompt, type McpResource, type McpSavedConfig, type McpTool } from '@/stores/mcp'
import { substVars } from '@/lib/substVars'
import { useEnvironmentsStore } from '@/stores/environments'
import { cn } from '@/lib/utils'

const DEFAULT_FORM: Omit<McpSavedConfig, 'id'> = {
  name: '',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  env: [],
  baseURL: '',
  bearerToken: '',
}

export function McpConnectionForm() {
  const {
    savedConfigs,
    activeConfigId,
    activeSessionId,
    status,
    statusError,
    serverInfo,
    sessions,
    restartingIds,
    addConfig,
    removeConfig,
    setActiveConfig,
    setActiveSession,
    setStatus,
    setServerInfo,
    setCapabilities,
    setSessions,
    setRestarting,
  } = useMcpStore()

  const [showForm, setShowForm] = useState(savedConfigs.length === 0)
  const [form, setForm] = useState<Omit<McpSavedConfig, 'id'>>(DEFAULT_FORM)
  const activeConfig = savedConfigs.find((cfg) => cfg.id === activeConfigId) ?? null
  const isRestarting = activeSessionId ? restartingIds.has(activeSessionId) : false

  const refreshSessions = async () => {
    try {
      const raw = await MCPClientBinding.ListSessions()
      const parsed = JSON.parse(raw)
      setSessions(Array.isArray(parsed) ? parsed : [])
    } catch {
      setSessions([])
    }
  }

  const buildResolvedConfigJSON = (config: McpSavedConfig): string => {
    const envVars = useEnvironmentsStore.getState().getResolvedVars()
    const stripMissing = (text: string) => substVars(text, envVars).replace(/\{\{[^}]+\}\}/g, '')
    return JSON.stringify({
      transport: config.transport,
      command: config.command,
      args: config.args,
      env: config.env.map(stripMissing),
      baseURL: stripMissing(config.baseURL),
      bearerToken: stripMissing(config.bearerToken),
    })
  }

  const loadCapabilities = async (sessionID: string) => {
    const [toolsRaw, resourcesRaw, promptsRaw] = await Promise.allSettled([
      MCPClientBinding.ListToolsSession(sessionID),
      MCPClientBinding.ListResourcesSession(sessionID),
      MCPClientBinding.ListPromptsSession(sessionID),
    ])

    setCapabilities({
      tools: toolsRaw.status === 'fulfilled' ? parseList<McpTool>(toolsRaw.value, 'tools') : [],
      resources: resourcesRaw.status === 'fulfilled' ? parseList<McpResource>(resourcesRaw.value, 'resources') : [],
      prompts: promptsRaw.status === 'fulfilled' ? parseList<McpPrompt>(promptsRaw.value, 'prompts') : [],
    })
  }

  const handleConnect = async (config = activeConfig) => {
    if (!config) return
    const sessionID = config.id
    setActiveSession(sessionID)
    setStatus('connecting')
    setServerInfo('')
    try {
      const info = await MCPClientBinding.ConnectSession(sessionID, buildResolvedConfigJSON(config))
      setServerInfo(info)
      setStatus('connected')
      await loadCapabilities(sessionID)
      await refreshSessions()
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
    }
  }

  const handleDisconnect = async (sessionID = activeSessionId) => {
    if (!sessionID) return
    try {
      await MCPClientBinding.DisconnectSession(sessionID)
    } catch {
      // The backend may already be disconnected; the UI should still reset.
    }
    if (sessionID === activeSessionId) {
      setStatus('disconnected')
      setServerInfo('')
      setCapabilities({ tools: [], resources: [], prompts: [] })
    }
    await refreshSessions()
  }

  const handleRestart = async (sessionID = activeSessionId) => {
    if (!sessionID) return
    setActiveSession(sessionID)
    setRestarting(sessionID, true)
    try {
      setStatus('connecting')
      const info = await MCPClientBinding.RestartSession(sessionID)
      setServerInfo(info)
      setStatus('connected')
      await loadCapabilities(sessionID)
      await refreshSessions()
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
    } finally {
      setRestarting(sessionID, false)
    }
  }

  const handleSave = () => {
    if (!form.name.trim()) return
    addConfig({ ...form, name: form.name.trim() })
    setShowForm(false)
    setForm(DEFAULT_FORM)
  }

  const statusIcon = {
    disconnected: <Plug size={11} className="text-text-4" />,
    connecting: <Plug size={11} className="text-warning animate-pulse" />,
    connected: <CheckCircle2 size={11} className="text-success" />,
    error: <AlertCircle size={11} className="text-danger" />,
  }[status]

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border-1 bg-surface-0">
      <div className="flex items-center justify-between border-b border-border-1 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">MCP Servers</span>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="rounded p-1 text-text-4 transition-colors hover:bg-surface-2 hover:text-text-1"
          title="Add MCP server"
        >
          <Plus size={13} />
        </button>
      </div>

      {showForm && (
        <div className="space-y-2 border-b border-border-1 bg-surface-1 p-2">
          <input
            placeholder="Name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
          <select
            value={form.transport}
            onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as McpSavedConfig['transport'] }))}
            className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
          >
            <option value="stdio">STDIO local process</option>
            <option value="http">HTTP/SSE remote</option>
          </select>

          {form.transport === 'stdio' ? (
            <>
              <input
                placeholder="Command"
                value={form.command}
                onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
              <textarea
                placeholder="Args, one per line"
                value={form.args.join('\n')}
                rows={3}
                onChange={(event) => setForm((current) => ({ ...current, args: event.target.value.split('\n').filter(Boolean) }))}
                className="w-full resize-none rounded border border-border-2 bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
            </>
          ) : (
            <>
              <input
                placeholder="Base URL"
                value={form.baseURL}
                onChange={(event) => setForm((current) => ({ ...current, baseURL: event.target.value }))}
                className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
              <input
                placeholder="Bearer token"
                value={form.bearerToken}
                onChange={(event) => setForm((current) => ({ ...current, bearerToken: event.target.value }))}
                className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
              />
            </>
          )}

          <textarea
            placeholder={'Env vars (KEY=VALUE, one per line)\nUse {{VAR}} from the active environment'}
            value={form.env.join('\n')}
            rows={2}
            onChange={(event) => setForm((current) => ({ ...current, env: event.target.value.split('\n').filter(Boolean) }))}
            className="w-full resize-none rounded border border-border-2 bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={handleSave} className="h-7 flex-1 rounded bg-accent text-[11px] font-medium text-white transition-colors hover:bg-accent-light">
              Save
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="h-7 flex-1 rounded bg-surface-2 text-[11px] text-text-3 transition-colors hover:bg-surface-3">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {savedConfigs.map((cfg) => {
          const session = sessions[cfg.id]
          const connected = session?.status === 'connected'
          const restarting = restartingIds.has(cfg.id)
          return (
          <div
            key={cfg.id}
            onClick={() => setActiveConfig(cfg.id)}
            className={cn(
              'group cursor-pointer px-3 py-2 text-left text-[11px] transition-colors',
              activeConfigId === cfg.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
            )}
          >
            <div className="flex items-center gap-2">
              <Server size={12} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{cfg.name}</span>
              <span className="rounded border border-border-1 px-1 py-0.5 font-mono text-[9px] text-text-4">{cfg.transport}</span>
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'bg-success' : session ? 'bg-warning' : 'bg-text-4',
              )} />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  removeConfig(cfg.id)
                }}
                className="rounded p-0.5 text-text-4 opacity-0 transition-all hover:bg-surface-3 hover:text-danger group-hover:opacity-100"
                title="Remove server"
              >
                <Trash2 size={10} />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-1 pl-5">
              {connected ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleRestart(cfg.id)
                    }}
                    disabled={restarting}
                    className="rounded border border-border-1 px-1.5 py-0.5 text-[9px] text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40"
                  >
                    Restart
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleDisconnect(cfg.id)
                    }}
                    className="rounded border border-border-1 px-1.5 py-0.5 text-[9px] text-text-3 hover:bg-surface-3 hover:text-text-1"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleConnect(cfg)
                  }}
                  className="rounded border border-border-1 px-1.5 py-0.5 text-[9px] text-accent hover:bg-accent/10"
                >
                  Connect
                </button>
              )}
              {session && <span className="truncate text-[9px] text-text-4">{session.status}</span>}
            </div>
          </div>
          )
        })}

        {savedConfigs.length === 0 && (
          <p className="px-4 py-5 text-center text-[11px] text-text-4">
            No servers saved. Add a local or remote MCP endpoint.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-border-1 p-2">
        {status === 'connected' && serverInfo && (
          <div className="truncate rounded border border-success/30 bg-success/10 px-2 py-1 font-mono text-[10px] text-success" title={serverInfo}>
            {formatServerInfo(serverInfo)}
          </div>
        )}
        {status === 'error' && (
          <p className="truncate px-1 text-[10px] text-danger" title={statusError}>
            {statusError}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          {statusIcon}
          {status === 'connected' ? (
            <>
              <button
                type="button"
              onClick={() => void handleRestart()}
              disabled={isRestarting}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-surface-2 text-[11px] font-medium text-text-2 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw size={12} className={isRestarting ? 'animate-spin' : ''} />
                Restart
              </button>
              <button
                type="button"
              onClick={() => void handleDisconnect()}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-surface-2 text-[11px] font-medium text-text-2 transition-colors hover:bg-surface-3"
              >
                <PlugZap size={12} />
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!activeConfig || status === 'connecting'}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-accent text-[11px] font-medium text-white transition-colors hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plug size={12} />
              {status === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

function parseList<T>(raw: string, key: string): T[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as T[]
    if (parsed && Array.isArray(parsed[key])) return parsed[key] as T[]
  } catch {
    return []
  }
  return []
}

function formatServerInfo(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { serverInfo?: { name?: string; version?: string } }
    const name = parsed.serverInfo?.name ?? 'MCP server'
    const version = parsed.serverInfo?.version ? ` ${parsed.serverInfo.version}` : ''
    return `${name}${version}`
  } catch {
    return 'Connected'
  }
}
