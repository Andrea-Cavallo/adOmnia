import { useState } from 'react'
import { AlertCircle, CheckCircle2, Plug, PlugZap, Plus, Server, Trash2 } from 'lucide-react'
import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
import { useMcpStore, type McpPrompt, type McpResource, type McpSavedConfig, type McpTool } from '@/stores/mcp'
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
    status,
    statusError,
    serverInfo,
    addConfig,
    removeConfig,
    setActiveConfig,
    setStatus,
    setServerInfo,
    setCapabilities,
  } = useMcpStore()

  const [showForm, setShowForm] = useState(savedConfigs.length === 0)
  const [form, setForm] = useState<Omit<McpSavedConfig, 'id'>>(DEFAULT_FORM)
  const activeConfig = savedConfigs.find((cfg) => cfg.id === activeConfigId) ?? null

  const handleConnect = async () => {
    if (!activeConfig) return
    setStatus('connecting')
    setServerInfo('')
    try {
      const cfgJSON = JSON.stringify({
        transport: activeConfig.transport,
        command: activeConfig.command,
        args: activeConfig.args,
        env: activeConfig.env,
        baseURL: activeConfig.baseURL,
        bearerToken: activeConfig.bearerToken,
      })
      const info = await MCPClientBinding.Connect(cfgJSON)
      setServerInfo(info)
      setStatus('connected')

      const [toolsRaw, resourcesRaw, promptsRaw] = await Promise.allSettled([
        MCPClientBinding.ListTools(),
        MCPClientBinding.ListResources(),
        MCPClientBinding.ListPrompts(),
      ])

      setCapabilities({
        tools: toolsRaw.status === 'fulfilled' ? parseList<McpTool>(toolsRaw.value, 'tools') : [],
        resources: resourcesRaw.status === 'fulfilled' ? parseList<McpResource>(resourcesRaw.value, 'resources') : [],
        prompts: promptsRaw.status === 'fulfilled' ? parseList<McpPrompt>(promptsRaw.value, 'prompts') : [],
      })
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
    }
  }

  const handleDisconnect = async () => {
    try {
      await MCPClientBinding.Disconnect()
    } catch {
      // The backend may already be disconnected; the UI should still reset.
    }
    setStatus('disconnected')
    setServerInfo('')
    setCapabilities({ tools: [], resources: [], prompts: [] })
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
            placeholder="Env entries, one per line"
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
        {savedConfigs.map((cfg) => (
          <div
            key={cfg.id}
            onClick={() => setActiveConfig(cfg.id)}
            className={cn(
              'group flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors',
              activeConfigId === cfg.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
            )}
          >
            <Server size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{cfg.name}</span>
            <span className="rounded border border-border-1 px-1 py-0.5 font-mono text-[9px] text-text-4">{cfg.transport}</span>
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
        ))}

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
            <button
              type="button"
              onClick={handleDisconnect}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-surface-2 text-[11px] font-medium text-text-2 transition-colors hover:bg-surface-3"
            >
              <PlugZap size={12} />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
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
