import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  FileCode2,
  FileSearch,
  Filter,
  Grid2X2,
  History,
  Info,
  List,
  Loader2,
  MoreVertical,
  Network,
  Play,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
import { cn } from '@/lib/utils'
import { substVars } from '@/lib/substVars'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import {
  useMcpStore,
  type McpCallEntry,
  type McpPrompt,
  type McpResource,
  type McpSavedConfig,
  type McpSelectedTab,
  type McpTool,
} from '@/stores/mcp'
import { McpServerGenPanel } from './McpServerGenPanel'
import { handleKeyboardActivation } from '@/lib/accessibility'

type McpView = 'debugger' | 'generator'
type ExplorerView = 'grid' | 'list'
type InspectorTab = 'overview' | 'params' | 'request' | 'response' | 'logs'

type SchemaProperty = {
  type?: string
  description?: string
  enum?: unknown[]
}

const DEFAULT_FORM: Omit<McpSavedConfig, 'id'> = {
  name: '',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  env: [],
  baseURL: '',
  bearerToken: '',
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function hasMcpBinding() {
  return typeof (window as unknown as {
    go?: { main?: { MCPClient?: unknown } }
  }).go?.main?.MCPClient === 'object'
}

function readProperties(tool: McpTool | null): Record<string, SchemaProperty> {
  const raw = tool?.inputSchema?.properties
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, SchemaProperty> : {}
}

function readRequired(tool: McpTool | null): string[] {
  const raw = tool?.inputSchema?.required
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

function readPromptArgs(prompt: McpPrompt | null): Record<string, string> {
  return Object.fromEntries((prompt?.arguments ?? []).map((arg) => [arg.name, '']))
}

function coerceValue(value: string, type?: string): unknown {
  if (value === '') return undefined
  if (type === 'number') return Number(value)
  if (type === 'integer') return Number.parseInt(value, 10)
  if (type === 'boolean') return value === 'true'
  return value
}

function serverInfoLabel(raw: string): string {
  if (!raw) return 'MCP Server'
  try {
    const parsed = JSON.parse(raw) as { serverInfo?: { name?: string; version?: string } }
    const name = parsed.serverInfo?.name ?? 'MCP Server'
    return parsed.serverInfo?.version ? `${name} ${parsed.serverInfo.version}` : name
  } catch {
    return 'MCP Server'
  }
}

function categoryForTool(tool: McpTool): string {
  const text = `${tool.name} ${tool.description}`.toLowerCase()
  if (text.includes('github') || text.includes('repo')) return 'GitHub'
  if (text.includes('file') || text.includes('directory') || text.includes('path')) return 'Files'
  if (text.includes('search')) return 'Search'
  if (text.includes('browser') || text.includes('web')) return 'Browser'
  if (text.includes('database') || text.includes('sql')) return 'Data'
  return 'General'
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function resultSize(raw: string): string {
  const bytes = new Blob([raw]).size
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function McpPanel() {
  const [view, setView] = useState<McpView>('debugger')

  if (view === 'generator') {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-surface-0 text-text-1">
        <McpTopMode view={view} onChange={setView} />
        <McpServerGenPanel />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-text-1">
      <McpTopMode view={view} onChange={setView} />
      <McpControlRoom />
    </div>
  )
}

function McpTopMode({ view, onChange }: { view: McpView; onChange: (view: McpView) => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-3">
      <button
        type="button"
        onClick={() => onChange('debugger')}
        className={cn(
          'h-10 border-b-2 px-3 text-[11px] font-semibold transition-colors',
          view === 'debugger' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
        )}
      >
        Control Room
      </button>
      <button
        type="button"
        onClick={() => onChange('generator')}
        className={cn(
          'h-10 border-b-2 px-3 text-[11px] font-semibold transition-colors',
          view === 'generator' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
        )}
      >
        Generate Server
      </button>
    </div>
  )
}

function McpControlRoom() {
  const {
    savedConfigs,
    activeConfigId,
    activeSessionId,
    status,
    statusError,
    serverInfo,
    capabilities,
    selectedTool,
    selectedPrompt,
    selectedTab,
    history,
    selectedHistoryId,
    sessions,
    restartingIds,
    addConfig,
    removeConfig,
    setActiveConfig,
    setActiveSession,
    setStatus,
    setServerInfo,
    setCapabilities,
    setSelectedTool,
    setSelectedPrompt,
    setSelectedTab,
    appendHistory,
    setSelectedHistory,
    clearHistory,
    setSessions,
    setRestarting,
    hydrateConfigs,
  } = useMcpStore()

  const workspaces = useCollectionsStore((state) => state.workspaces)
  const activeWorkspaceId = useCollectionsStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useCollectionsStore((state) => state.setActiveWorkspace)
  const environments = useEnvironmentsStore((state) => state.environments)
  const activeEnvId = useEnvironmentsStore((state) => state.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((state) => state.setActiveEnv)

  const [serverSearch, setServerSearch] = useState('')
  const [toolSearch, setToolSearch] = useState('')
  const [category, setCategory] = useState('All Categories')
  const [explorerView, setExplorerView] = useState<ExplorerView>('grid')
  const [showForm, setShowForm] = useState(savedConfigs.length === 0)
  const [form, setForm] = useState<Omit<McpSavedConfig, 'id'>>(DEFAULT_FORM)
  const [selectedResourceUri, setSelectedResourceUri] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('overview')
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [rawMode, setRawMode] = useState(false)
  const [rawArgs, setRawArgs] = useState('{}')
  const [calling, setCalling] = useState(false)
  const [lastResult, setLastResult] = useState<{ raw: string; isError: boolean; durationMs: number; toolName: string } | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [gettingPrompt, setGettingPrompt] = useState(false)
  const [promptResult, setPromptResult] = useState('')

  const activeConfig = savedConfigs.find((cfg) => cfg.id === activeConfigId) ?? null
  const activeSession = activeSessionId ? sessions[activeSessionId] : null
  const isRestarting = activeSessionId ? restartingIds.has(activeSessionId) : false
  const tool = capabilities.tools.find((item) => item.name === selectedTool) ?? null
  const prompt = capabilities.prompts.find((item) => item.name === selectedPrompt) ?? null
  const resource = capabilities.resources.find((item) => item.uri === selectedResourceUri) ?? capabilities.resources[0] ?? null
  const properties = useMemo(() => readProperties(tool), [tool])
  const required = useMemo(() => readRequired(tool), [tool])
  const categories = useMemo(() => ['All Categories', ...Array.from(new Set(capabilities.tools.map(categoryForTool))).sort()], [capabilities.tools])
  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase()
    return capabilities.tools.filter((item) => {
      const matchesCategory = category === 'All Categories' || categoryForTool(item) === category
      const matchesText = !q || `${item.name} ${item.description}`.toLowerCase().includes(q)
      return matchesCategory && matchesText
    })
  }, [capabilities.tools, category, toolSearch])
  const filteredServers = useMemo(() => {
    const q = serverSearch.trim().toLowerCase()
    return savedConfigs.filter((cfg) => !q || `${cfg.name} ${cfg.transport} ${cfg.command} ${cfg.baseURL}`.toLowerCase().includes(q))
  }, [savedConfigs, serverSearch])

  useEffect(() => {
    void hydrateConfigs()
  }, [hydrateConfigs])

  useEffect(() => {
    if (savedConfigs.length > 0) setShowForm(false)
  }, [savedConfigs.length])

  useEffect(() => {
    if (!tool && capabilities.tools.length > 0) setSelectedTool(capabilities.tools[0].name)
  }, [capabilities.tools, setSelectedTool, tool])

  useEffect(() => {
    if (!prompt && capabilities.prompts.length > 0) setSelectedPrompt(capabilities.prompts[0].name)
  }, [capabilities.prompts, prompt, setSelectedPrompt])

  useEffect(() => {
    if (!selectedResourceUri && capabilities.resources.length > 0) setSelectedResourceUri(capabilities.resources[0].uri)
  }, [capabilities.resources, selectedResourceUri])

  useEffect(() => {
    setArgValues(Object.fromEntries(Object.keys(properties).map((key) => [key, ''])))
    setRawArgs('{}')
  }, [properties, selectedTool])

  useEffect(() => {
    setPromptArgs(readPromptArgs(prompt))
    setPromptResult('')
  }, [prompt])

  useEffect(() => {
    void refreshSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshSessions = async () => {
    if (!hasMcpBinding()) return
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
    const stripMissing = (text: string) => substVars(text, envVars).replace(/\{\{[^}]+\}/g, '')
    return JSON.stringify({
      transport: config.transport,
      command: stripMissing(config.command),
      args: config.args.map(stripMissing),
      env: config.env.map(stripMissing),
      baseURL: stripMissing(config.baseURL),
      bearerToken: stripMissing(config.bearerToken),
    })
  }

  const loadCapabilities = async (sessionID: string) => {
    if (!hasMcpBinding()) return
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
    setActiveSession(config.id)
    setStatus('connecting')
    setServerInfo('')
    try {
      if (!hasMcpBinding()) throw new Error('MCP backend is available inside the Wails desktop runtime.')
      const info = await MCPClientBinding.ConnectSession(config.id, buildResolvedConfigJSON(config))
      setServerInfo(info)
      setStatus('connected')
      await loadCapabilities(config.id)
      await refreshSessions()
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
    }
  }

  const handleDisconnect = async (sessionID = activeSessionId) => {
    if (!sessionID) return
    try {
      if (hasMcpBinding()) await MCPClientBinding.DisconnectSession(sessionID)
    } catch {
      // The session may already be closed.
    }
    if (sessionID === activeSessionId) {
      setStatus('disconnected')
      setServerInfo('')
      setCapabilities({ tools: [], resources: [], prompts: [] })
      setSelectedTool(null)
      setSelectedPrompt(null)
      setSelectedResourceUri(null)
    }
    await refreshSessions()
  }

  const handleRestart = async (sessionID = activeSessionId) => {
    if (!sessionID) return
    setActiveSession(sessionID)
    setRestarting(sessionID, true)
    try {
      if (!hasMcpBinding()) throw new Error('MCP backend is available inside the Wails desktop runtime.')
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

  const saveServer = () => {
    if (!form.name.trim()) return
    addConfig({ ...form, name: form.name.trim() })
    setForm(DEFAULT_FORM)
    setShowForm(false)
  }

  const runTool = async () => {
    if (!tool || !activeSessionId || status !== 'connected') return
    setCalling(true)
    setLastResult(null)
    const startedAt = Date.now()
    let args: Record<string, unknown> = {}

    try {
      if (!hasMcpBinding()) throw new Error('MCP backend is available inside the Wails desktop runtime.')
      if (rawMode) {
        const parsed = JSON.parse(rawArgs)
        args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
      } else {
        args = Object.fromEntries(
          Object.entries(argValues)
            .map(([key, value]) => [key, coerceValue(value, properties[key]?.type)] as const)
            .filter(([, value]) => value !== undefined),
        )
      }
      const result = await MCPClientBinding.CallToolSession(activeSessionId, tool.name, JSON.stringify(args))
      const parsedResult = (() => {
        try {
          return JSON.parse(result) as { isError?: boolean }
        } catch {
          return null
        }
      })()
      const isError = parsedResult?.isError === true
      const durationMs = Date.now() - startedAt
      setLastResult({ raw: result, isError, durationMs, toolName: tool.name })
      appendHistory({ id: makeId(), ts: Date.now(), toolName: tool.name, args, result, isError, durationMs })
    } catch (error) {
      const result = error instanceof Error ? error.message : String(error)
      const durationMs = Date.now() - startedAt
      setLastResult({ raw: result, isError: true, durationMs, toolName: tool.name })
      appendHistory({ id: makeId(), ts: Date.now(), toolName: tool.name, args, result, isError: true, durationMs })
    } finally {
      setCalling(false)
    }
  }

  const getPrompt = async () => {
    if (!prompt || !activeSessionId || status !== 'connected') return
    setGettingPrompt(true)
    setPromptResult('')
    try {
      if (!hasMcpBinding()) throw new Error('MCP backend is available inside the Wails desktop runtime.')
      const args = Object.fromEntries(Object.entries(promptArgs).filter(([, value]) => value !== ''))
      const result = await MCPClientBinding.GetPromptSession(activeSessionId, prompt.name, JSON.stringify(args))
      setPromptResult(result)
    } catch (error) {
      setPromptResult(error instanceof Error ? error.message : String(error))
    } finally {
      setGettingPrompt(false)
    }
  }

  const activeServerName = activeConfig?.name ?? serverInfoLabel(serverInfo)
  const activeServerConnected = status === 'connected' || activeSession?.status === 'connected'

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[278px_minmax(560px,1fr)_374px] grid-rows-[72px_minmax(0,1fr)] overflow-hidden">
      <header className="col-span-3 grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border-1 bg-surface-1 px-5">
        <div>
          <div className="flex items-center gap-2">
            <Network size={17} className="text-accent" />
            <h2 className="text-[17px] font-semibold tracking-tight text-text-1">MCP Client</h2>
          </div>
          <p className="mt-0.5 text-[12px] text-text-3">MCP Control Room</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="min-w-[210px] text-[10px] uppercase tracking-wide text-text-4">
            Workspace
            <select
              value={activeWorkspaceId}
              onChange={(event) => setActiveWorkspace(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-border-1 bg-surface-2 px-2 text-[12px] normal-case tracking-normal text-text-1 outline-none focus:border-accent"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px] text-[10px] uppercase tracking-wide text-text-4">
            Environment
            <select
              value={activeEnvId ?? ''}
              onChange={(event) => setActiveEnv(event.target.value || null)}
              className="mt-1 h-8 w-full rounded-md border border-border-1 bg-surface-2 px-2 text-[12px] normal-case tracking-normal text-text-1 outline-none focus:border-accent"
            >
              <option value="">No environment</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-[260px] rounded-md border border-border-1 bg-surface-2 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-text-4">Active Server</div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', activeServerConnected ? 'bg-success' : status === 'error' ? 'bg-error' : 'bg-text-4')} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-1">{activeServerName}</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-[10px] font-semibold',
                activeServerConnected ? 'bg-success/15 text-success' : status === 'error' ? 'bg-error/15 text-error' : 'bg-surface-3/70 text-text-2',
              )}>
                {status}
              </span>
              <ChevronDown size={13} className="text-text-4" />
            </div>
          </div>
          {activeServerConnected ? (
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[12px] font-semibold text-white shadow-[0_0_22px_var(--color-accent-glow)] transition-colors hover:bg-accent-hover"
            >
              <PlugZap size={14} />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={!activeConfig || status === 'connecting'}
              className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[12px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
            >
              {status === 'connecting' ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              Connect
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex h-9 items-center gap-2 rounded-md border border-border-1 bg-surface-3 px-4 text-[12px] font-semibold text-text-1 hover:border-accent/50 hover:text-text-1"
          >
            <Plus size={14} />
            Add Server
          </button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-border-1 bg-surface-3 text-text-3 hover:text-text-1" title="MCP options">
            <MoreVertical size={15} />
          </button>
        </div>
      </header>

      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-text-1">MCP Servers</h3>
            <button type="button" onClick={() => setShowForm((value) => !value)} className="grid h-7 w-7 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text-1">
              <Plus size={15} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-[1fr_34px] gap-2">
            <label className="flex h-9 items-center gap-2 rounded-md border border-border-1 bg-surface-2 px-2 text-text-4 focus-within:border-accent">
              <Search size={14} />
              <input value={serverSearch} onChange={(event) => setServerSearch(event.target.value)} placeholder="Search servers..." className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4" />
            </label>
            <button type="button" className="grid h-9 place-items-center rounded-md border border-border-1 bg-surface-2 text-text-3 hover:text-text-1" title="Filter servers">
              <Filter size={14} />
            </button>
          </div>
        </div>

        {showForm && (
          <div className="space-y-2 border-b border-border-1 bg-surface-2 p-3">
            <input
              placeholder="Server name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="h-8 w-full rounded-md border border-border-1 bg-surface-3 px-2 text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
            />
            <select
              value={form.transport}
              onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as McpSavedConfig['transport'] }))}
              className="h-8 w-full rounded-md border border-border-1 bg-surface-3 px-2 text-[12px] text-text-1 outline-none focus:border-accent"
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
                  className="h-8 w-full rounded-md border border-border-1 bg-surface-3 px-2 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
                />
                <textarea
                  placeholder="Args, one per line"
                  rows={3}
                  value={form.args.join('\n')}
                  onChange={(event) => setForm((current) => ({ ...current, args: event.target.value.split('\n').filter(Boolean) }))}
                  className="w-full resize-none rounded-md border border-border-1 bg-surface-3 px-2 py-1.5 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
                />
              </>
            ) : (
              <>
                <input
                  placeholder="Base URL"
                  value={form.baseURL}
                  onChange={(event) => setForm((current) => ({ ...current, baseURL: event.target.value }))}
                  className="h-8 w-full rounded-md border border-border-1 bg-surface-3 px-2 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
                />
                <input
                  placeholder="Bearer token"
                  value={form.bearerToken}
                  onChange={(event) => setForm((current) => ({ ...current, bearerToken: event.target.value }))}
                  className="h-8 w-full rounded-md border border-border-1 bg-surface-3 px-2 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
                />
              </>
            )}
            <textarea
              placeholder="Env vars: KEY=VALUE, one per line"
              rows={2}
              value={form.env.join('\n')}
              onChange={(event) => setForm((current) => ({ ...current, env: event.target.value.split('\n').filter(Boolean) }))}
              className="w-full resize-none rounded-md border border-border-1 bg-surface-3 px-2 py-1.5 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={saveServer} className="h-8 rounded-md bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover">Save</button>
              <button type="button" onClick={() => setShowForm(false)} className="h-8 rounded-md border border-border-1 bg-surface-2 text-[12px] text-text-2 hover:text-text-1">Cancel</button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ServerGroup
            title="Local"
            count={filteredServers.filter((cfg) => cfg.transport === 'stdio').length}
            configs={filteredServers.filter((cfg) => cfg.transport === 'stdio')}
            activeConfigId={activeConfigId}
            sessions={sessions}
            capabilitiesCount={capabilities.tools.length}
            onSelect={setActiveConfig}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRemove={removeConfig}
          />
          <ServerGroup
            title="Remote"
            count={filteredServers.filter((cfg) => cfg.transport === 'http').length}
            configs={filteredServers.filter((cfg) => cfg.transport === 'http')}
            activeConfigId={activeConfigId}
            sessions={sessions}
            capabilitiesCount={capabilities.tools.length}
            onSelect={setActiveConfig}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRemove={removeConfig}
          />
          {filteredServers.length === 0 && (
            <div className="mt-8 rounded-lg border border-dashed border-border-1 p-5 text-center text-[12px] text-text-4">
              No MCP servers yet.
            </div>
          )}
        </div>

        <div className="border-t border-border-1 p-3">
          {status === 'error' && (
            <div className="mb-2 rounded-md border border-error/25 bg-error/10 p-2 text-[11px] text-error" title={statusError}>
              {statusError}
            </div>
          )}
          <button
            type="button"
            onClick={() => status === 'connected' ? void handleRestart() : void handleConnect()}
            disabled={!activeConfig || status === 'connecting'}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-accent/30 bg-accent/18 text-[12px] font-semibold text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {status === 'connecting' || isRestarting ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            {status === 'connected' ? 'Restart Server' : status === 'connecting' ? 'Connecting...' : 'Connect Server'}
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border-1 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-text-1">Capabilities Explorer</h3>
                <p className="mt-0.5 text-[11px] text-text-4">
                  {status === 'connected' ? `${capabilities.tools.length} tools, ${capabilities.resources.length} resources, ${capabilities.prompts.length} prompts` : 'Connect a server to inspect tools, resources and prompts.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => activeSessionId && void loadCapabilities(activeSessionId)}
                disabled={!activeSessionId || status !== 'connected'}
                className="flex h-8 items-center gap-2 rounded-md border border-border-1 bg-surface-3 px-3 text-[12px] text-text-2 hover:text-text-1 disabled:opacity-40"
              >
                <RefreshCw size={13} />
                Refresh
              </button>
            </div>
            <div className="mt-4 flex items-center gap-1 border-b border-border-1">
              {(['tools', 'resources', 'prompts'] as McpSelectedTab[]).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setSelectedTab(tab)}
                  className={cn(
                    'h-9 border-b-2 px-3 text-[12px] font-semibold capitalize transition-colors',
                    selectedTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
                  )}
                >
                  {tab}
                  <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-3">
                    {selectedTabCount(tab, capabilities)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedTab('tools')}
                className="ml-3 h-9 border-b-2 border-transparent px-3 text-[12px] font-semibold text-text-3 hover:text-text-1"
              >
                Server Info
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(220px,1fr)_180px_82px] gap-2">
              <label className="flex h-9 items-center gap-2 rounded-md border border-border-1 bg-surface-2 px-2 text-text-4 focus-within:border-accent">
                <Search size={14} />
                <input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder={`Search ${selectedTab}...`} className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4" />
              </label>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-9 rounded-md border border-border-1 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent"
              >
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <div className="grid grid-cols-2 rounded-md border border-border-1 bg-surface-2 p-1">
                <button type="button" onClick={() => setExplorerView('grid')} className={cn('grid place-items-center rounded text-text-3', explorerView === 'grid' && 'bg-accent/20 text-accent')}><Grid2X2 size={14} /></button>
                <button type="button" onClick={() => setExplorerView('list')} className={cn('grid place-items-center rounded text-text-3', explorerView === 'list' && 'bg-accent/20 text-accent')}><List size={14} /></button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {status !== 'connected' ? (
              <EmptyState icon={<Plug size={22} />} title="Connect an MCP server first." text="Saved servers stay local. Once connected, tools, resources and prompts appear here." />
            ) : selectedTab === 'tools' ? (
              filteredTools.length > 0 ? (
                <div className={cn(explorerView === 'grid' ? 'grid grid-cols-2 gap-3 2xl:grid-cols-3' : 'space-y-2')}>
                  {filteredTools.map((item) => (
                    <ToolCard
                      key={item.name}
                      tool={item}
                      active={selectedTool === item.name}
                      history={history}
                      compact={explorerView === 'list'}
                      onClick={() => {
                        setSelectedTool(item.name)
                        setInspectorTab('overview')
                      }}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Search size={22} />} title="No tools match." text="Try another query or category." />
              )
            ) : selectedTab === 'resources' ? (
              capabilities.resources.length > 0 ? (
                <div className="space-y-2">
                  {capabilities.resources.map((item) => (
                    <button
                      type="button"
                      key={item.uri}
                      onClick={() => setSelectedResourceUri(item.uri)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left transition-colors',
                        resource?.uri === item.uri ? 'border-accent/70 bg-accent/12' : 'border-border-1 bg-surface-2 hover:border-border-2',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <FileCode2 size={16} className="text-info" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-text-1">{item.name || item.uri}</span>
                        <span className="rounded bg-info/15 px-2 py-0.5 text-[10px] text-info">{item.mimeType || 'resource'}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[12px] text-text-3">{item.description || item.uri}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<FileCode2 size={22} />} title="No resources exposed." text="This server did not publish resource descriptors." />
              )
            ) : capabilities.prompts.length > 0 ? (
              <div className="space-y-2">
                {capabilities.prompts.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    onClick={() => {
                      setSelectedPrompt(item.name)
                      setInspectorTab('overview')
                    }}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      selectedPrompt === item.name ? 'border-accent/70 bg-accent/12' : 'border-border-1 bg-surface-2 hover:border-border-2',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} className="text-accent" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-text-1">{item.name}</span>
                      <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] text-accent">{item.arguments.length} args</span>
                    </div>
                    {item.description && <p className="mt-2 line-clamp-2 text-[12px] text-text-3">{item.description}</p>}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Sparkles size={22} />} title="No prompts exposed." text="This server did not publish prompt templates." />
            )}
          </div>
        </section>

        <CallHistoryTable history={history} selectedHistoryId={selectedHistoryId} onSelect={setSelectedHistory} onClear={clearHistory} />
      </main>

      <aside className="flex min-h-0 flex-col bg-surface-1">
        <Inspector
          selectedTab={selectedTab}
          inspectorTab={inspectorTab}
          onInspectorTab={setInspectorTab}
          tool={tool}
          prompt={prompt}
          resource={resource}
          status={status}
          properties={properties}
          required={required}
          argValues={argValues}
          onArgValues={setArgValues}
          rawMode={rawMode}
          onRawMode={setRawMode}
          rawArgs={rawArgs}
          onRawArgs={setRawArgs}
          calling={calling}
          onRunTool={() => void runTool()}
          lastResult={lastResult}
          promptArgs={promptArgs}
          onPromptArgs={setPromptArgs}
          gettingPrompt={gettingPrompt}
          onGetPrompt={() => void getPrompt()}
          promptResult={promptResult}
          serverInfo={serverInfo}
          activeConfig={activeConfig}
        />
      </aside>
    </div>
  )
}

function selectedTabCount(tab: McpSelectedTab, capabilities: { tools: McpTool[]; resources: McpResource[]; prompts: McpPrompt[] }) {
  if (tab === 'tools') return capabilities.tools.length
  if (tab === 'resources') return capabilities.resources.length
  return capabilities.prompts.length
}

function ServerGroup(props: {
  title: string
  count: number
  configs: McpSavedConfig[]
  activeConfigId: string | null
  sessions: Record<string, { status: string }>
  capabilitiesCount: number
  onSelect: (id: string) => void
  onConnect: (config: McpSavedConfig) => void
  onDisconnect: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (props.count === 0) return null
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-text-4">
        {props.title}
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-text-3">{props.count}</span>
      </div>
      <div className="space-y-2">
        {props.configs.map((cfg) => {
          const connected = props.sessions[cfg.id]?.status === 'connected'
          const active = props.activeConfigId === cfg.id
          return (
            <div
              key={cfg.id}
              className={cn(
                'group w-full rounded-lg border text-left transition-colors focus-within:ring-2 focus-within:ring-accent',
                active ? 'border-accent/70 bg-accent/14 shadow-[0_0_22px_var(--color-accent-glow)]' : 'border-border-1 bg-surface-2 hover:border-border-2',
              )}
            >
              <button type="button" aria-pressed={active} onClick={() => props.onSelect(cfg.id)} className="w-full p-3 pb-0 text-left outline-none">
                <span className="flex items-center gap-2">
                  <Server size={17} className={connected ? 'text-success' : 'text-text-3'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-text-1">{cfg.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-3">
                      <span>{cfg.transport.toUpperCase()}</span>
                      <span>•</span>
                      <span className={connected ? 'text-success' : 'text-text-4'}>{connected ? 'Connected' : 'Idle'}</span>
                    </span>
                  </span>
                  <span className="rounded-md bg-surface-3 px-2 py-1 text-[10px] font-semibold text-text-2">{active ? props.capabilitiesCount : ''}</span>
                </span>
              </button>
              <div className="mx-3 mb-3 mt-3 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {connected ? (
                  <button type="button" onClick={(event) => { event.stopPropagation(); props.onDisconnect(cfg.id) }} className="rounded border border-border-1 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">Disconnect</button>
                ) : (
                  <button type="button" onClick={(event) => { event.stopPropagation(); props.onConnect(cfg) }} className="rounded border border-accent/30 px-2 py-1 text-[10px] text-accent hover:bg-accent/10">Connect</button>
                )}
                <button type="button" aria-label={`Remove ${cfg.name}`} title={`Remove ${cfg.name}`} onClick={(event) => { event.stopPropagation(); props.onRemove(cfg.id) }} className="ml-auto rounded p-1 text-text-4 hover:bg-error/10 hover:text-error">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ToolCard({ tool, active, history, compact, onClick }: { tool: McpTool; active: boolean; history: McpCallEntry[]; compact: boolean; onClick: () => void }) {
  const last = history.find((entry) => entry.toolName === tool.name)
  const props = readProperties(tool)
  const category = categoryForTool(tool)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border text-left transition-colors',
        active ? 'border-accent/80 bg-accent/12 shadow-[0_0_22px_var(--color-accent-glow)]' : 'border-border-1 bg-surface-2 hover:border-border-2',
        compact ? 'grid grid-cols-[1fr_auto] gap-3 p-3' : 'p-4',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-info/20 bg-info/10 text-info">
          <FileSearch size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-semibold text-text-1">{tool.name}</span>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">{category}</span>
          </div>
          <p className="mt-2 line-clamp-2 min-h-[34px] text-[12px] leading-5 text-text-3">{tool.description || 'No description provided.'}</p>
          <div className="mt-3 rounded-md border border-border-1 bg-surface-0/60 px-2 py-2 font-mono text-[10px] text-text-3">
            {Object.keys(props).length ? Object.entries(props).slice(0, 3).map(([key, value]) => `${key}: ${value.type ?? 'any'}`).join(', ') : 'No parameters'}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[10px] text-text-4">
        <span>Last call: {last ? relativeTime(last.ts) : 'never'}</span>
        <span>•</span>
        <span className={last?.isError ? 'text-error' : last ? 'text-success' : 'text-text-4'}>
          {last ? (last.isError ? 'Error' : 'Success') : 'Ready'}
        </span>
      </div>
    </button>
  )
}

function CallHistoryTable({ history, selectedHistoryId, onSelect, onClear }: {
  history: McpCallEntry[]
  selectedHistoryId: string | null
  onSelect: (id: string | null) => void
  onClear: () => void
}) {
  return (
    <section className="h-[220px] shrink-0 border-t border-border-1 bg-surface-1">
      <div className="flex h-12 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-text-1">
          <History size={15} className="text-text-3" />
          Call History
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-3">{history.length}</span>
        </div>
        <button type="button" onClick={onClear} disabled={history.length === 0} className="flex h-8 items-center gap-2 rounded-md border border-border-1 px-3 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-40">
          <RefreshCw size={13} />
          Clear
        </button>
      </div>
      <div className="h-[calc(100%-48px)] overflow-auto">
        <table className="min-w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-surface-1 text-[10px] uppercase tracking-wide text-text-4">
            <tr>
              <th className="px-4 py-2 font-semibold">Time</th>
              <th className="px-4 py-2 font-semibold">Tool</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Duration</th>
              <th className="px-4 py-2 font-semibold">Response</th>
              <th className="px-4 py-2 font-semibold">Cursor</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr
                key={entry.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${entry.toolName} call from ${new Date(entry.ts).toLocaleTimeString()}`}
                onClick={() => onSelect(selectedHistoryId === entry.id ? null : entry.id)}
                onKeyDown={(event) => handleKeyboardActivation(event, () => onSelect(selectedHistoryId === entry.id ? null : entry.id))}
                className={cn('cursor-pointer border-t border-border-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', selectedHistoryId === entry.id && 'bg-accent/10')}
              >
                <td className="px-4 py-2 text-text-2">{new Date(entry.ts).toLocaleTimeString()}</td>
                <td className="px-4 py-2 font-mono text-text-2">{entry.toolName}</td>
                <td className="px-4 py-2">
                  <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold', entry.isError ? 'bg-error/15 text-error' : 'bg-success/15 text-success')}>
                    {entry.isError ? 'Error' : 'Success'}
                  </span>
                </td>
                <td className="px-4 py-2 text-text-3">{entry.durationMs}ms</td>
                <td className="px-4 py-2 text-text-3">{resultSize(entry.result)}</td>
                <td className="px-4 py-2 text-text-4">{relativeTime(entry.ts)}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-4">No calls yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Inspector(props: {
  selectedTab: McpSelectedTab
  inspectorTab: InspectorTab
  onInspectorTab: (tab: InspectorTab) => void
  tool: McpTool | null
  prompt: McpPrompt | null
  resource: McpResource | null
  status: string
  properties: Record<string, SchemaProperty>
  required: string[]
  argValues: Record<string, string>
  onArgValues: (values: Record<string, string>) => void
  rawMode: boolean
  onRawMode: (value: boolean) => void
  rawArgs: string
  onRawArgs: (value: string) => void
  calling: boolean
  onRunTool: () => void
  lastResult: { raw: string; isError: boolean; durationMs: number; toolName: string } | null
  promptArgs: Record<string, string>
  onPromptArgs: (values: Record<string, string>) => void
  gettingPrompt: boolean
  onGetPrompt: () => void
  promptResult: string
  serverInfo: string
  activeConfig: McpSavedConfig | null
}) {
  const name = props.selectedTab === 'tools' ? props.tool?.name : props.selectedTab === 'prompts' ? props.prompt?.name : props.resource?.name
  const description = props.selectedTab === 'tools' ? props.tool?.description : props.selectedTab === 'prompts' ? props.prompt?.description : props.resource?.description

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-1 px-4">
        <h3 className="text-[13px] font-semibold text-text-1">Tool Inspector</h3>
        <div className="flex items-center gap-1">
          <button type="button" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><Settings2 size={14} /></button>
          <button type="button" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"><X size={14} /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!name ? (
          <EmptyState icon={<Info size={22} />} title="Nothing selected." text={props.status === 'connected' ? 'Pick a capability from the explorer.' : 'Connect a server first.'} />
        ) : (
          <>
            <div className="border-b border-border-1 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-info/20 bg-info/10 text-info">
                  {props.selectedTab === 'prompts' ? <Sparkles size={21} /> : props.selectedTab === 'resources' ? <FileCode2 size={21} /> : <FileSearch size={21} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] font-semibold text-text-1">{name}</span>
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent">{props.selectedTab}</span>
                  </div>
                  {description && <p className="mt-1.5 text-[12px] leading-5 text-text-3">{description}</p>}
                </div>
              </div>
            </div>
            <div className="flex border-b border-border-1 px-3">
              {(['overview', 'params', 'request', 'response', 'logs'] as InspectorTab[]).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => props.onInspectorTab(tab)}
                  className={cn(
                    'h-10 border-b-2 px-2.5 text-[11px] font-semibold capitalize',
                    props.inspectorTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="space-y-4 p-4">
              {props.selectedTab === 'tools' && props.tool && (
                <ToolInspectorBody {...props} />
              )}
              {props.selectedTab === 'prompts' && props.prompt && (
                <PromptInspectorBody {...props} />
              )}
              {props.selectedTab === 'resources' && props.resource && (
                <ResourceInspectorBody resource={props.resource} />
              )}
            </div>
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-border-1 p-4">
        <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-text-1">
          <span>Execution Logs</span>
          <span className="text-[10px] font-normal text-text-4">{props.lastResult ? '1 entry' : '0 entries'}</span>
        </div>
        <div className="rounded-lg border border-border-1 bg-surface-2 p-3 text-[11px] text-text-3">
          {props.lastResult ? `${props.lastResult.toolName} finished in ${props.lastResult.durationMs}ms` : props.serverInfo ? `Connected to ${serverInfoLabel(props.serverInfo)}` : props.activeConfig ? `Selected ${props.activeConfig.name}` : 'No log entries yet.'}
        </div>
      </div>
    </>
  )
}

function ToolInspectorBody(props: Parameters<typeof Inspector>[0]) {
  const result = props.lastResult
  return (
    <>
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-semibold text-text-1">Parameters</h4>
        <button type="button" onClick={() => props.onRawMode(!props.rawMode)} className={cn('text-[11px] font-semibold', props.rawMode ? 'text-accent' : 'text-text-3 hover:text-text-1')}>
          Edit as JSON
        </button>
      </div>
      {props.rawMode ? (
        <textarea value={props.rawArgs} onChange={(event) => props.onRawArgs(event.target.value)} rows={8} spellCheck={false} className="w-full resize-none rounded-md border border-border-1 bg-surface-2 p-3 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
      ) : Object.keys(props.properties).length > 0 ? (
        Object.entries(props.properties).map(([key, property]) => (
          <label key={key} className="block">
            <span className="text-[12px] text-text-2">
              {key} {props.required.includes(key) && <span className="text-error">*</span>}
            </span>
            {property.description && <span className="mt-1 block text-[11px] text-text-4">{property.description}</span>}
            {Array.isArray(property.enum) ? (
              <select value={props.argValues[key] ?? ''} onChange={(event) => props.onArgValues({ ...props.argValues, [key]: event.target.value })} className="mt-2 h-9 w-full rounded-md border border-border-1 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent">
                <option value="">Unset</option>
                {property.enum.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
              </select>
            ) : property.type === 'boolean' ? (
              <button type="button" onClick={() => props.onArgValues({ ...props.argValues, [key]: props.argValues[key] === 'true' ? 'false' : 'true' })} className={cn('mt-2 h-8 w-12 rounded-full border p-1 transition-colors', props.argValues[key] === 'true' ? 'border-success/50 bg-success/20' : 'border-border-1 bg-surface-2')}>
                <span className={cn('block h-5 w-5 rounded-full bg-text-2 transition-transform', props.argValues[key] === 'true' && 'translate-x-5 bg-success')} />
              </button>
            ) : (
              <input value={props.argValues[key] ?? ''} onChange={(event) => props.onArgValues({ ...props.argValues, [key]: event.target.value })} className="mt-2 h-9 w-full rounded-md border border-border-1 bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent" />
            )}
          </label>
        ))
      ) : (
        <p className="rounded-md border border-border-1 bg-surface-2 p-3 text-[12px] text-text-3">This tool does not declare input arguments.</p>
      )}
      <button type="button" onClick={props.onRunTool} disabled={props.calling || props.status !== 'connected'} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">
        {props.calling ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {props.calling ? 'Running...' : 'Run Tool'}
      </button>
      {result && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[12px] font-semibold text-text-1">Last Result</h4>
            <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold', result.isError ? 'bg-error/15 text-error' : 'bg-success/15 text-success')}>
              {result.isError ? 'Error' : 'Success'}
            </span>
          </div>
          <pre className="max-h-[270px] overflow-auto whitespace-pre-wrap rounded-lg border border-border-1 bg-surface-2 p-3 font-mono text-[11px] leading-5 text-text-2">
            {formatJSON(result.raw)}
          </pre>
        </div>
      )}
    </>
  )
}

function PromptInspectorBody(props: Parameters<typeof Inspector>[0]) {
  return (
    <>
      <h4 className="text-[12px] font-semibold text-text-1">Prompt Arguments</h4>
      {props.prompt?.arguments.length ? props.prompt.arguments.map((arg) => (
        <label key={arg.name} className="block">
          <span className="text-[12px] text-text-2">{arg.name} {arg.required && <span className="text-error">*</span>}</span>
          {arg.description && <span className="mt-1 block text-[11px] text-text-4">{arg.description}</span>}
          <input value={props.promptArgs[arg.name] ?? ''} onChange={(event) => props.onPromptArgs({ ...props.promptArgs, [arg.name]: event.target.value })} className="mt-2 h-9 w-full rounded-md border border-border-1 bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent" />
        </label>
      )) : (
        <p className="rounded-md border border-border-1 bg-surface-2 p-3 text-[12px] text-text-3">This prompt does not declare arguments.</p>
      )}
      <button type="button" onClick={props.onGetPrompt} disabled={props.gettingPrompt || props.status !== 'connected'} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent text-[12px] font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">
        {props.gettingPrompt ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
        {props.gettingPrompt ? 'Getting...' : 'Get Prompt'}
      </button>
      {props.promptResult && (
        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-border-1 bg-surface-2 p-3 font-mono text-[11px] leading-5 text-text-2">
          {formatJSON(props.promptResult)}
        </pre>
      )}
    </>
  )
}

function ResourceInspectorBody({ resource }: { resource: McpResource }) {
  return (
    <div className="space-y-3">
      <InfoRow label="URI" value={resource.uri} />
      <InfoRow label="MIME" value={resource.mimeType || 'unknown'} />
      <InfoRow label="Description" value={resource.description || 'No description provided.'} />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-1 bg-surface-2 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-4">{label}</div>
      <div className="mt-1 break-words font-mono text-[12px] text-text-1">{value}</div>
    </div>
  )
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center p-8 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border-1 bg-surface-2 text-text-3">{icon}</div>
        <div className="mt-4 text-[13px] font-semibold text-text-1">{title}</div>
        <p className="mt-1 max-w-[320px] text-[12px] leading-5 text-text-4">{text}</p>
      </div>
    </div>
  )
}
