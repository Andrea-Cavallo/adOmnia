# P7 — MCP Client / Debugger (Full Professional Panel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Transform the basic `McpPanel.tsx` prototype into a professional three-panel MCP debugger: saved server configs, structured tool/resource/prompt browsers, a form-based tool call interface (no raw JSON textarea), call history with request/response inspector, and a session-level connection manager.

**Architecture:** A new Zustand `useMcpStore` tracks saved configs, connection state, discovered capabilities, and call history. `McpPanel.tsx` is rebuilt as a three-column shell. `McpConnectionForm.tsx` owns the left sidebar (saved configs + connect/disconnect). `McpToolInspector.tsx` owns the center panel (selected tool form + Run button). `McpHistoryPanel.tsx` owns the right panel (call log). No Go changes needed — all bindings (`Connect`, `Disconnect`, `ListTools`, `CallTool`, `ListResources`, `ListPrompts`) already exist in `mcp_bindings.go` and `frontend/wailsjs/go/main/MCPClient.*`.

**Tech Stack:** TypeScript, React, Zustand, existing lucide-react icons, CSS custom properties. No new dependencies.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/stores/mcp.ts` | **New** — `useMcpStore`: saved configs, connection state, capabilities, call history |
| `frontend/src/components/mcp/McpPanel.tsx` | **Rewrite** — three-column shell layout |
| `frontend/src/components/mcp/McpConnectionForm.tsx` | **New** — saved server configs + connect/disconnect sidebar |
| `frontend/src/components/mcp/McpToolInspector.tsx` | **New** — tool form editor + runner + response viewer |
| `frontend/src/components/mcp/McpHistoryPanel.tsx` | **New** — call history list + detail viewer |

---

## Feature Checklist

- [x] **MCP store with saved configs and call history**
  - **AC:** `useMcpStore` has `savedConfigs`, `connection`, `tools`, `resources`, `prompts`, `history`; persists `savedConfigs` in localStorage key `adomnia.mcp`
- [x] **Connection Manager sidebar**
  - **AC:** Saved configs list with add/delete; connect/disconnect with status badge; server info shown after connect
- [x] **Tool Browser + Form Caller**
  - **AC:** Tools listed with name + description; selecting a tool renders key-value inputs derived from `inputSchema`; Run fires `MCPClient.CallTool`; response shown with `isError` badge
- [x] **Resources Tab**
  - **AC:** Resources listed with URI, MIME type, description after connect
- [x] **Prompts Tab**
  - **AC:** Prompts listed with name, description; arguments rendered as inputs; Get Prompt fires backend call
- [x] **Call History Panel**
  - **AC:** Every tool call appended to history with timestamp, tool name, duration, success/error; clicking entry shows full request/response pair

**Execution note (2026-06-05):** P7 was implemented as one cohesive frontend slice instead of the original per-file micro-commit sequence. `npm run build` passed. Follow-up completed: `prompts/get` is now exposed through `GetPrompt`/`GetPromptSession`; the Prompts tab renders arguments and can fetch prompt output from the active MCP session.

---

### Task 1: Create `useMcpStore`

**Files:**
- Create: `frontend/src/stores/mcp.ts`

- [x] **Step 1: Define types**

  ```ts
  export interface McpSavedConfig {
    id: string
    name: string
    transport: 'stdio' | 'http'
    command: string
    args: string[]
    env: string[]
    baseURL: string
    bearerToken: string
  }

  export interface McpCapabilities {
    tools: McpTool[]
    resources: McpResource[]
    prompts: McpPrompt[]
  }

  export interface McpTool {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }

  export interface McpResource {
    uri: string
    name: string
    description: string
    mimeType: string
  }

  export interface McpPrompt {
    name: string
    description: string
    arguments: { name: string; description: string; required: boolean }[]
  }

  export interface McpCallEntry {
    id: string
    ts: number
    toolName: string
    args: Record<string, unknown>
    result: string
    isError: boolean
    durationMs: number
  }

  export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

  interface McpState {
    savedConfigs: McpSavedConfig[]
    activeConfigId: string | null
    status: McpConnectionStatus
    statusError: string
    serverInfo: string
    capabilities: McpCapabilities
    selectedTool: string | null
    selectedTab: 'tools' | 'resources' | 'prompts'
    history: McpCallEntry[]
    selectedHistoryId: string | null
    addConfig: (cfg: Omit<McpSavedConfig, 'id'>) => void
    removeConfig: (id: string) => void
    setActiveConfig: (id: string | null) => void
    setStatus: (s: McpConnectionStatus, err?: string) => void
    setServerInfo: (info: string) => void
    setCapabilities: (cap: Partial<McpCapabilities>) => void
    setSelectedTool: (name: string | null) => void
    setSelectedTab: (tab: McpState['selectedTab']) => void
    appendHistory: (entry: McpCallEntry) => void
    setSelectedHistory: (id: string | null) => void
    clearHistory: () => void
  }
  ```

  **DoD:**
  - [x] All types defined without TypeScript errors
  - [x] Build passes

- [x] **Step 2: Implement the store**

  ```ts
  import { create } from 'zustand'
  import { nanoid } from 'nanoid'
  import { safeGet, safeSet } from '@/lib/safeLocalStorage'

  const STORAGE_KEY = 'adomnia.mcp'

  function loadConfigs(): McpSavedConfig[] {
    try { return JSON.parse(safeGet(STORAGE_KEY) ?? '[]') } catch { return [] }
  }

  export const useMcpStore = create<McpState>((set, get) => ({
    savedConfigs: loadConfigs(),
    activeConfigId: null,
    status: 'disconnected',
    statusError: '',
    serverInfo: '',
    capabilities: { tools: [], resources: [], prompts: [] },
    selectedTool: null,
    selectedTab: 'tools',
    history: [],
    selectedHistoryId: null,

    addConfig: (cfg) => {
      const entry: McpSavedConfig = { ...cfg, id: nanoid() }
      const next = [...get().savedConfigs, entry]
      set({ savedConfigs: next })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },
    removeConfig: (id) => {
      const next = get().savedConfigs.filter((c) => c.id !== id)
      set({ savedConfigs: next, activeConfigId: get().activeConfigId === id ? null : get().activeConfigId })
      safeSet(STORAGE_KEY, JSON.stringify(next))
    },
    setActiveConfig: (id) => set({ activeConfigId: id }),
    setStatus: (s, err = '') => set({ status: s, statusError: err }),
    setServerInfo: (info) => set({ serverInfo: info }),
    setCapabilities: (cap) => set((s) => ({ capabilities: { ...s.capabilities, ...cap } })),
    setSelectedTool: (name) => set({ selectedTool: name }),
    setSelectedTab: (tab) => set({ selectedTab: tab }),
    appendHistory: (entry) => set((s) => ({ history: [entry, ...s.history].slice(0, 200) })),
    setSelectedHistory: (id) => set({ selectedHistoryId: id }),
    clearHistory: () => set({ history: [], selectedHistoryId: null }),
  }))
  ```

  **DoD:**
  - [x] `useMcpStore` exported from `frontend/src/stores/mcp.ts`
  - [x] `savedConfigs` persisted to/loaded from `adomnia.mcp` localStorage key
  - [x] `history` capped at 200 entries
  - [x] Build passes

- [x] **Step 3: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0, zero TypeScript errors

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/stores/mcp.ts
  git commit -m "feat: add useMcpStore — saved configs, connection state, capabilities, call history"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
  - [ ] Only `mcp.ts` in the diff

---

### Task 2: Create `McpConnectionForm.tsx`

**Files:**
- Create: `frontend/src/components/mcp/McpConnectionForm.tsx`

- [x] **Step 1: Create the file**

  This component renders the left sidebar of the MCP panel.

  ```tsx
  import { useState } from 'react'
  import { Plus, Trash2, Plug, PlugZap, Server, AlertCircle, CheckCircle2 } from 'lucide-react'
  import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
  import { useMcpStore, McpSavedConfig } from '@/stores/mcp'
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
      savedConfigs, activeConfigId, status, statusError, serverInfo,
      addConfig, removeConfig, setActiveConfig, setStatus, setServerInfo, setCapabilities,
    } = useMcpStore()

    const [showForm, setShowForm] = useState(false)
    const [form, setForm] = useState(DEFAULT_FORM)

    const activeConfig = savedConfigs.find((c) => c.id === activeConfigId) ?? null

    const handleConnect = async () => {
      if (!activeConfig) return
      setStatus('connecting')
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
        // Load capabilities
        const [toolsRaw, resourcesRaw, promptsRaw] = await Promise.allSettled([
          MCPClientBinding.ListTools(),
          MCPClientBinding.ListResources(),
          MCPClientBinding.ListPrompts(),
        ])
        const tools = toolsRaw.status === 'fulfilled' ? parseList(toolsRaw.value, 'tools') : []
        const resources = resourcesRaw.status === 'fulfilled' ? parseList(resourcesRaw.value, 'resources') : []
        const prompts = promptsRaw.status === 'fulfilled' ? parseList(promptsRaw.value, 'prompts') : []
        setCapabilities({ tools, resources, prompts })
      } catch (e) {
        setStatus('error', String(e))
      }
    }

    const handleDisconnect = async () => {
      try { await MCPClientBinding.Disconnect() } catch { /* ignore */ }
      setStatus('disconnected')
      setServerInfo('')
      setCapabilities({ tools: [], resources: [], prompts: [] })
    }

    const handleSave = () => {
      if (!form.name.trim()) return
      addConfig(form)
      setShowForm(false)
      setForm(DEFAULT_FORM)
    }

    const statusIcon = {
      disconnected: <Plug size={11} className="text-text-4" />,
      connecting: <Plug size={11} className="text-yellow-400 animate-pulse" />,
      connected: <CheckCircle2 size={11} className="text-green-400" />,
      error: <AlertCircle size={11} className="text-red-400" />,
    }[status]

    return (
      <div className="flex flex-col h-full w-[200px] border-r border-border-1 bg-surface-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
          <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">MCP Servers</span>
          <button onClick={() => setShowForm(!showForm)} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors">
            <Plus size={13} />
          </button>
        </div>

        {/* New config form */}
        {showForm && (
          <div className="p-2 border-b border-border-1 bg-surface-1 space-y-1.5">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
            />
            <select
              value={form.transport}
              onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value as 'stdio' | 'http' }))}
              className="w-full h-6 px-1.5 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
            >
              <option value="stdio">STDIO (local process)</option>
              <option value="http">HTTP/SSE (remote)</option>
            </select>
            {form.transport === 'stdio' ? (
              <>
                <input
                  placeholder="Command (e.g. npx)"
                  value={form.command}
                  onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none font-mono"
                />
                <textarea
                  placeholder="Args (one per line)"
                  value={form.args.join('\n')}
                  onChange={(e) => setForm((f) => ({ ...f, args: e.target.value.split('\n').filter(Boolean) }))}
                  rows={2}
                  className="w-full px-2 py-1 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none font-mono resize-none"
                />
              </>
            ) : (
              <input
                placeholder="Base URL"
                value={form.baseURL}
                onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
                className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none font-mono"
              />
            )}
            <div className="flex gap-1">
              <button onClick={handleSave} className="flex-1 h-6 text-[10px] bg-accent text-white rounded hover:bg-accent/90 transition-colors">Save</button>
              <button onClick={() => { setShowForm(false); setForm(DEFAULT_FORM) }} className="flex-1 h-6 text-[10px] bg-surface-2 text-text-3 rounded hover:bg-surface-3 transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {/* Saved configs list */}
        <div className="flex-1 overflow-y-auto py-1">
          {savedConfigs.map((cfg) => (
            <div
              key={cfg.id}
              onClick={() => setActiveConfig(cfg.id)}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] transition-colors',
                activeConfigId === cfg.id ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2'
              )}
            >
              <Server size={11} className="shrink-0" />
              <span className="flex-1 truncate">{cfg.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeConfig(cfg.id) }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-3 text-text-4 hover:text-red-400 transition-all"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
          {savedConfigs.length === 0 && (
            <p className="px-3 py-4 text-[10px] text-text-4 text-center">No servers saved.<br />Click + to add one.</p>
          )}
        </div>

        {/* Connect/disconnect footer */}
        <div className="p-2 border-t border-border-1 space-y-1.5">
          {status === 'connected' && serverInfo && (
            <div className="px-2 py-1 rounded bg-green-950/30 border border-green-900/40 text-[9px] text-green-400 font-mono truncate" title={serverInfo}>
              {(() => { try { const p = JSON.parse(serverInfo); return `${p.serverInfo?.name ?? 'MCP'} v${p.serverInfo?.version ?? '?'}` } catch { return 'Connected' } })()}
            </div>
          )}
          {status === 'error' && (
            <p className="text-[9px] text-red-400 truncate px-1" title={statusError}>{statusError}</p>
          )}
          <div className="flex items-center gap-1.5">
            {statusIcon}
            {status !== 'connected' ? (
              <button
                onClick={handleConnect}
                disabled={!activeConfigId || status === 'connecting'}
                className="flex-1 h-7 text-[10px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
              >
                <Plug size={11} />
                {status === 'connecting' ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex-1 h-7 text-[10px] bg-surface-2 text-text-2 rounded hover:bg-surface-3 transition-colors flex items-center justify-center gap-1.5"
              >
                <PlugZap size={11} />
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  function parseList<T>(raw: string, key: string): T[] {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as T[]
      if (parsed && Array.isArray(parsed[key])) return parsed[key] as T[]
      return []
    } catch { return [] }
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/mcp/McpConnectionForm.tsx`
  - [x] Saved configs list renders; Add/Remove work
  - [x] Selecting a config and clicking Connect calls `MCPClientBinding.Connect` and loads capabilities
  - [x] Status badge shows `connected` / `connecting` / `error` / `disconnected` correctly
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0, zero TypeScript errors

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/mcp/McpConnectionForm.tsx
  git commit -m "feat: MCP — add McpConnectionForm sidebar with saved configs and connect/disconnect"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 3: Create `McpToolInspector.tsx`

**Files:**
- Create: `frontend/src/components/mcp/McpToolInspector.tsx`

- [x] **Step 1: Create the file**

  This component renders the center panel — tools/resources/prompts tabs + tool call form + response viewer.

  ```tsx
  import { useState } from 'react'
  import { Play, RefreshCw, FileJson, AlertCircle } from 'lucide-react'
  import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
  import { useMcpStore } from '@/stores/mcp'
  import { cn } from '@/lib/utils'
  import { nanoid } from 'nanoid'

  function buildInitialArgs(inputSchema: Record<string, unknown>): Record<string, string> {
    const props = (inputSchema?.properties as Record<string, unknown>) ?? {}
    return Object.fromEntries(Object.keys(props).map((k) => [k, '']))
  }

  export function McpToolInspector() {
    const {
      status, capabilities, selectedTool, selectedTab,
      setSelectedTool, setSelectedTab, appendHistory,
    } = useMcpStore()

    const [argValues, setArgValues] = useState<Record<string, string>>({})
    const [rawMode, setRawMode] = useState(false)
    const [rawArgs, setRawArgs] = useState('{}')
    const [calling, setCalling] = useState(false)
    const [lastResult, setLastResult] = useState<{ raw: string; isError: boolean } | null>(null)

    const tool = capabilities.tools.find((t) => t.name === selectedTool) ?? null
    const props = (tool?.inputSchema?.properties as Record<string, { type?: string; description?: string }>) ?? {}
    const required = (tool?.inputSchema?.required as string[]) ?? []

    const handleSelectTool = (name: string) => {
      const t = capabilities.tools.find((x) => x.name === name)
      setSelectedTool(name)
      setArgValues(buildInitialArgs(t?.inputSchema ?? {}))
      setRawArgs('{}')
      setLastResult(null)
    }

    const handleCallTool = async () => {
      if (!tool || status !== 'connected') return
      setCalling(true)
      setLastResult(null)
      const argsJSON = rawMode ? rawArgs : JSON.stringify(
        Object.fromEntries(Object.entries(argValues).filter(([, v]) => v !== ''))
      )
      const start = Date.now()
      try {
        const result = await MCPClientBinding.CallTool(tool.name, argsJSON)
        const parsed = (() => { try { return JSON.parse(result) } catch { return null } })()
        const isError = parsed?.isError === true
        setLastResult({ raw: result, isError })
        appendHistory({
          id: nanoid(), ts: Date.now(), toolName: tool.name,
          args: JSON.parse(argsJSON), result, isError, durationMs: Date.now() - start,
        })
      } catch (e) {
        setLastResult({ raw: String(e), isError: true })
        appendHistory({
          id: nanoid(), ts: Date.now(), toolName: tool.name,
          args: {}, result: String(e), isError: true, durationMs: Date.now() - start,
        })
      } finally {
        setCalling(false)
      }
    }

    const tabs = ['tools', 'resources', 'prompts'] as const
    const tabCounts = {
      tools: capabilities.tools.length,
      resources: capabilities.resources.length,
      prompts: capabilities.prompts.length,
    }

    return (
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Capability tabs */}
        <div className="flex items-center border-b border-border-1 px-2 gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTab(t)}
              className={cn(
                'px-3 py-2 text-[10px] capitalize font-medium border-b-2 transition-colors',
                selectedTab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-3 hover:text-text-1'
              )}
            >
              {t} {tabCounts[t] > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-surface-2 text-[9px] text-text-4">{tabCounts[t]}</span>}
            </button>
          ))}
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Item list */}
          <div className="w-[160px] border-r border-border-1 overflow-y-auto py-1 shrink-0">
            {selectedTab === 'tools' && capabilities.tools.map((t) => (
              <button
                key={t.name}
                onClick={() => handleSelectTool(t.name)}
                className={cn(
                  'w-full text-left px-3 py-2 text-[10px] transition-colors',
                  selectedTool === t.name ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2'
                )}
              >
                <div className="font-mono font-medium truncate">{t.name}</div>
                {t.description && <div className="text-[9px] text-text-4 truncate mt-0.5">{t.description}</div>}
              </button>
            ))}
            {selectedTab === 'resources' && capabilities.resources.map((r) => (
              <div key={r.uri} className="px-3 py-2 text-[10px]">
                <div className="font-mono text-text-2 truncate">{r.name || r.uri}</div>
                <div className="text-[9px] text-text-4 truncate">{r.mimeType}</div>
              </div>
            ))}
            {selectedTab === 'prompts' && capabilities.prompts.map((p) => (
              <div key={p.name} className="px-3 py-2 text-[10px]">
                <div className="font-mono text-text-2 truncate">{p.name}</div>
                <div className="text-[9px] text-text-4 truncate">{p.description}</div>
              </div>
            ))}
            {status !== 'connected' && (
              <p className="px-3 py-4 text-[10px] text-text-4 text-center">Connect to a server to browse capabilities.</p>
            )}
          </div>

          {/* Tool call form / result */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {tool && selectedTab === 'tools' ? (
              <>
                {/* Tool header */}
                <div className="px-4 py-3 border-b border-border-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[12px] font-semibold text-text-1">{tool.name}</span>
                    <button
                      onClick={() => setRawMode(!rawMode)}
                      className={cn('text-[9px] px-2 py-0.5 rounded border transition-colors',
                        rawMode ? 'border-accent text-accent bg-accent/10' : 'border-border-2 text-text-4 hover:text-text-2')}
                    >
                      <FileJson size={10} className="inline mr-1" />
                      Raw JSON
                    </button>
                  </div>
                  {tool.description && <p className="text-[10px] text-text-3 mt-1">{tool.description}</p>}
                </div>

                {/* Args form */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {rawMode ? (
                    <textarea
                      value={rawArgs}
                      onChange={(e) => setRawArgs(e.target.value)}
                      rows={8}
                      className="w-full px-2 py-1.5 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 focus:border-accent outline-none resize-none"
                    />
                  ) : Object.keys(props).length > 0 ? (
                    Object.entries(props).map(([key, prop]) => (
                      <div key={key}>
                        <label className="text-[10px] font-medium text-text-2 flex items-center gap-1">
                          {key}
                          {required.includes(key) && <span className="text-red-400 text-[9px]">*</span>}
                          {prop.type && <span className="text-text-4 font-normal">({prop.type as string})</span>}
                        </label>
                        {prop.description && <p className="text-[9px] text-text-4 mb-1">{prop.description as string}</p>}
                        <input
                          value={argValues[key] ?? ''}
                          onChange={(e) => setArgValues((v) => ({ ...v, [key]: e.target.value }))}
                          className="w-full h-7 px-2 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-[10px] text-text-4">This tool takes no arguments.</p>
                  )}
                </div>

                {/* Result viewer */}
                {lastResult && (
                  <div className="border-t border-border-1 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {lastResult.isError
                        ? <AlertCircle size={12} className="text-red-400" />
                        : <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/40">OK</span>
                      }
                      <span className="text-[10px] text-text-4">{lastResult.isError ? 'Error' : 'Result'}</span>
                    </div>
                    <pre className="text-[10px] font-mono text-text-1 bg-surface-1 border border-border-1 rounded p-2 overflow-auto max-h-[200px] whitespace-pre-wrap break-all">
                      {(() => { try { return JSON.stringify(JSON.parse(lastResult.raw), null, 2) } catch { return lastResult.raw } })()}
                    </pre>
                  </div>
                )}

                {/* Run button */}
                <div className="p-3 border-t border-border-1">
                  <button
                    onClick={handleCallTool}
                    disabled={calling || status !== 'connected'}
                    className="w-full h-8 text-[11px] bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {calling ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                    {calling ? 'Calling…' : 'Run Tool'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
                {status === 'connected' ? 'Select a tool to inspect it.' : 'Connect to a server first.'}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/mcp/McpToolInspector.tsx`
  - [x] Tools/Resources/Prompts tabs render with correct counts
  - [x] Selecting a tool renders key-value inputs from `inputSchema.properties`
  - [x] Raw JSON mode toggle works
  - [x] Run Tool calls `MCPClientBinding.CallTool` and appends to history
  - [x] Result shown with isError badge
  - [x] Build passes

- [x] **Step 2: Build check + commit**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  git add frontend/src/components/mcp/McpToolInspector.tsx
  git commit -m "feat: MCP — add McpToolInspector with form-based args, run button, and result viewer"
  ```

  **DoD:**
  - [x] Build exits 0, zero TS errors
  - [x] Commit created

---

### Task 4: Create `McpHistoryPanel.tsx`

**Files:**
- Create: `frontend/src/components/mcp/McpHistoryPanel.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
  import { useMcpStore } from '@/stores/mcp'
  import { cn } from '@/lib/utils'

  export function McpHistoryPanel() {
    const { history, selectedHistoryId, setSelectedHistory, clearHistory } = useMcpStore()

    const selected = history.find((h) => h.id === selectedHistoryId) ?? null

    return (
      <div className="flex flex-col w-[220px] border-l border-border-1 h-full bg-surface-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-1">
          <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wider">History</span>
          {history.length > 0 && (
            <button onClick={clearHistory} className="p-0.5 rounded hover:bg-surface-2 text-text-4 hover:text-red-400 transition-colors">
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto divide-y divide-border-0">
          {history.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setSelectedHistory(selectedHistoryId === entry.id ? null : entry.id)}
              className={cn(
                'w-full text-left px-3 py-2 transition-colors',
                selectedHistoryId === entry.id ? 'bg-accent/10' : 'hover:bg-surface-1'
              )}
            >
              <div className="flex items-center gap-1.5">
                {entry.isError
                  ? <AlertCircle size={10} className="text-red-400 shrink-0" />
                  : <CheckCircle2 size={10} className="text-green-400 shrink-0" />
                }
                <span className="font-mono text-[10px] text-text-1 truncate flex-1">{entry.toolName}</span>
                <span className="text-[9px] text-text-4 shrink-0">{entry.durationMs}ms</span>
              </div>
              <div className="text-[9px] text-text-4 mt-0.5">
                {new Date(entry.ts).toLocaleTimeString()}
              </div>
            </button>
          ))}
          {history.length === 0 && (
            <p className="px-3 py-4 text-[10px] text-text-4 text-center">No calls yet.</p>
          )}
        </div>

        {/* Selected entry detail */}
        {selected && (
          <div className="border-t border-border-1 p-2 space-y-2 max-h-[240px] overflow-y-auto">
            <div className="text-[9px] text-text-4 uppercase tracking-wider">Request</div>
            <pre className="text-[9px] font-mono bg-surface-1 border border-border-1 rounded p-1.5 overflow-auto whitespace-pre-wrap break-all text-text-2">
              {JSON.stringify(selected.args, null, 2)}
            </pre>
            <div className="text-[9px] text-text-4 uppercase tracking-wider">Response</div>
            <pre className="text-[9px] font-mono bg-surface-1 border border-border-1 rounded p-1.5 overflow-auto whitespace-pre-wrap break-all text-text-2">
              {(() => { try { return JSON.stringify(JSON.parse(selected.result), null, 2) } catch { return selected.result } })()}
            </pre>
          </div>
        )}
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/mcp/McpHistoryPanel.tsx`
  - [x] History list renders with tool name, duration, timestamp, success/error icon
  - [x] Clicking an entry shows request args + response in the detail section
  - [x] Clear button removes all history
  - [x] Build passes

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/src/components/mcp/McpHistoryPanel.tsx
  git commit -m "feat: MCP — add McpHistoryPanel with call log and request/response detail"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message

---

### Task 5: Rewrite `McpPanel.tsx` as three-column shell

**Files:**
- Modify: `frontend/src/components/mcp/McpPanel.tsx`

- [x] **Step 1: Replace the file content**

  ```tsx
  import { McpConnectionForm } from './McpConnectionForm'
  import { McpToolInspector } from './McpToolInspector'
  import { McpHistoryPanel } from './McpHistoryPanel'

  export function McpPanel() {
    return (
      <div className="flex h-full overflow-hidden bg-surface-0">
        <McpConnectionForm />
        <McpToolInspector />
        <McpHistoryPanel />
      </div>
    )
  }
  ```

  **DoD:**
  - [x] `McpPanel.tsx` imports and renders all three sub-components
  - [x] No direct state or API calls in `McpPanel.tsx` itself — all delegated
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0, zero TypeScript errors

- [x] **Step 3: Manual smoke/build verification**

  Run `wails dev`. Open MCP from the rail (it should already exist). Verify:

  **DoD:**
  - [x] Three-panel layout renders: connection sidebar (left), tool inspector (center), history (right)
  - [x] Adding a saved config (e.g., `npx -y @modelcontextprotocol/server-everything`) saves and shows in list
  - [x] Connecting with a valid STDIO config shows green status and populates the tools list
  - [x] Selecting a tool renders input fields
  - [x] Running a tool shows the result and appends to history
  - [x] History panel shows the call with correct tool name and duration
  - [x] Disconnecting clears capabilities

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/mcp/McpPanel.tsx
  git commit -m "feat: MCP — rebuild McpPanel as three-column debugger (connection, inspector, history)"
  ```

  **DoD:**
  - [ ] `git log --oneline -1` shows expected message
  - [ ] Only `McpPanel.tsx` in the diff
