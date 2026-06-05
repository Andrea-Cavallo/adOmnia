import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileJson, Play, RefreshCw } from 'lucide-react'
import * as MCPClientBinding from '@/wailsjs/go/main/MCPClient'
import { useMcpStore, type McpPrompt, type McpTool } from '@/stores/mcp'
import { cn } from '@/lib/utils'

type SchemaProperty = {
  type?: string
  description?: string
  enum?: unknown[]
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function McpToolInspector() {
  const {
    status,
    activeSessionId,
    capabilities,
    selectedTool,
    selectedPrompt,
    selectedTab,
    setSelectedTool,
    setSelectedPrompt,
    setSelectedTab,
    appendHistory,
  } = useMcpStore()

  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [rawMode, setRawMode] = useState(false)
  const [rawArgs, setRawArgs] = useState('{}')
  const [calling, setCalling] = useState(false)
  const [lastResult, setLastResult] = useState<{ raw: string; isError: boolean } | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [gettingPrompt, setGettingPrompt] = useState(false)
  const [promptResult, setPromptResult] = useState<string>('')

  const tool = capabilities.tools.find((item) => item.name === selectedTool) ?? null
  const prompt = capabilities.prompts.find((item) => item.name === selectedPrompt) ?? null
  const properties = useMemo(() => readProperties(tool), [tool])
  const required = useMemo(() => readRequired(tool), [tool])

  useEffect(() => {
    if (!tool && capabilities.tools.length > 0) {
      setSelectedTool(capabilities.tools[0].name)
    }
  }, [capabilities.tools, setSelectedTool, tool])

  useEffect(() => {
    if (!prompt && capabilities.prompts.length > 0) {
      setSelectedPrompt(capabilities.prompts[0].name)
    }
  }, [capabilities.prompts, prompt, setSelectedPrompt])

  useEffect(() => {
    setArgValues(Object.fromEntries(Object.keys(properties).map((key) => [key, ''])))
    setRawArgs('{}')
    setLastResult(null)
  }, [properties, selectedTool])

  useEffect(() => {
    setPromptArgs(readPromptArgs(prompt))
    setPromptResult('')
  }, [prompt])

  const handleCallTool = async () => {
    if (!tool || !activeSessionId || status !== 'connected') return
    setCalling(true)
    setLastResult(null)
    const startedAt = Date.now()
    let args: Record<string, unknown> = {}

    try {
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
      setLastResult({ raw: result, isError })
      appendHistory({
        id: makeId(),
        ts: Date.now(),
        toolName: tool.name,
        args,
        result,
        isError,
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      const result = error instanceof Error ? error.message : String(error)
      setLastResult({ raw: result, isError: true })
      appendHistory({
        id: makeId(),
        ts: Date.now(),
        toolName: tool.name,
        args,
        result,
        isError: true,
        durationMs: Date.now() - startedAt,
      })
    } finally {
      setCalling(false)
    }
  }

  const handleGetPrompt = async () => {
    if (!prompt || !activeSessionId || status !== 'connected') return
    setGettingPrompt(true)
    setPromptResult('')
    try {
      const args = Object.fromEntries(
        Object.entries(promptArgs).filter(([, value]) => value !== ''),
      )
      const result = await MCPClientBinding.GetPromptSession(activeSessionId, prompt.name, JSON.stringify(args))
      setPromptResult(result)
    } catch (error) {
      setPromptResult(error instanceof Error ? error.message : String(error))
    } finally {
      setGettingPrompt(false)
    }
  }

  const tabs = ['tools', 'resources', 'prompts'] as const
  const counts = {
    tools: capabilities.tools.length,
    resources: capabilities.resources.length,
    prompts: capabilities.prompts.length,
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-surface-0">
      <div className="flex items-center gap-1 border-b border-border-1 px-2">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={cn(
              'border-b-2 px-3 py-2 text-[11px] font-medium capitalize transition-colors',
              selectedTab === tab ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
            )}
          >
            {tab}
            <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 text-[9px] text-text-4">{counts[tab]}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[190px] shrink-0 overflow-y-auto border-r border-border-1 py-1">
          {selectedTab === 'tools' && capabilities.tools.map((item) => (
            <button
              type="button"
              key={item.name}
              onClick={() => setSelectedTool(item.name)}
              className={cn(
                'w-full px-3 py-2 text-left text-[11px] transition-colors',
                selectedTool === item.name ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <div className="truncate font-mono font-medium">{item.name}</div>
              {item.description && <div className="mt-0.5 truncate text-[10px] text-text-4">{item.description}</div>}
            </button>
          ))}

          {selectedTab === 'resources' && capabilities.resources.map((resource) => (
            <div key={resource.uri} className="border-b border-border-0 px-3 py-2 text-[11px]">
              <div className="truncate font-mono text-text-1">{resource.name || resource.uri}</div>
              <div className="mt-0.5 truncate text-[10px] text-text-4">{resource.mimeType || resource.uri}</div>
              {resource.description && <div className="mt-1 text-[10px] text-text-3">{resource.description}</div>}
            </div>
          ))}

          {selectedTab === 'prompts' && capabilities.prompts.map((prompt) => (
            <button
              type="button"
              key={prompt.name}
              onClick={() => setSelectedPrompt(prompt.name)}
              className={cn(
                'w-full border-b border-border-0 px-3 py-2 text-left text-[11px] transition-colors',
                selectedPrompt === prompt.name ? 'bg-accent/10 text-accent' : 'text-text-2 hover:bg-surface-2',
              )}
            >
              <div className="truncate font-mono text-text-1">{prompt.name}</div>
              {prompt.description && <div className="mt-0.5 text-[10px] text-text-4">{prompt.description}</div>}
              {prompt.arguments.length > 0 && <div className="mt-1 text-[10px] text-text-3">{prompt.arguments.length} args</div>}
            </button>
          ))}

          {status !== 'connected' && (
            <p className="px-4 py-5 text-center text-[11px] text-text-4">Connect to browse server capabilities.</p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {tool && selectedTab === 'tools' ? (
            <>
              <div className="border-b border-border-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-mono text-[13px] font-semibold text-text-1">{tool.name}</span>
                  <button
                    type="button"
                    onClick={() => setRawMode((value) => !value)}
                    className={cn(
                      'flex h-7 items-center gap-1 rounded border px-2 text-[10px] transition-colors',
                      rawMode ? 'border-accent bg-accent/10 text-accent' : 'border-border-2 text-text-4 hover:text-text-2',
                    )}
                  >
                    <FileJson size={11} />
                    Raw JSON
                  </button>
                </div>
                {tool.description && <p className="mt-1 text-[11px] text-text-3">{tool.description}</p>}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {rawMode ? (
                  <textarea
                    value={rawArgs}
                    onChange={(event) => setRawArgs(event.target.value)}
                    rows={8}
                    spellCheck={false}
                    className="w-full resize-none rounded border border-border-2 bg-surface-1 px-2 py-1.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                  />
                ) : Object.keys(properties).length > 0 ? (
                  Object.entries(properties).map(([key, property]) => (
                    <div key={key}>
                      <label className="flex items-center gap-1 text-[11px] font-medium text-text-2">
                        {key}
                        {required.includes(key) && <span className="text-danger">*</span>}
                        {property.type && <span className="font-normal text-text-4">({property.type})</span>}
                      </label>
                      {property.description && <p className="mb-1 mt-0.5 text-[10px] text-text-4">{property.description}</p>}
                      {Array.isArray(property.enum) ? (
                        <select
                          value={argValues[key] ?? ''}
                          onChange={(event) => setArgValues((current) => ({ ...current, [key]: event.target.value }))}
                          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                        >
                          <option value="">Unset</option>
                          {property.enum.map((value) => (
                            <option key={String(value)} value={String(value)}>{String(value)}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={argValues[key] ?? ''}
                          onChange={(event) => setArgValues((current) => ({ ...current, [key]: event.target.value }))}
                          className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-text-4">This tool does not declare input arguments.</p>
                )}
              </div>

              {lastResult && (
                <div className="border-t border-border-1 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    {lastResult.isError ? (
                      <AlertCircle size={13} className="text-danger" />
                    ) : (
                      <span className="rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">OK</span>
                    )}
                    <span className="text-[11px] text-text-4">{lastResult.isError ? 'Error' : 'Result'}</span>
                  </div>
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-1">
                    {formatJSON(lastResult.raw)}
                  </pre>
                </div>
              )}

              <div className="border-t border-border-1 p-3">
                <button
                  type="button"
                  onClick={handleCallTool}
                  disabled={calling || status !== 'connected'}
                  className="flex h-8 w-full items-center justify-center gap-2 rounded bg-accent text-[11px] font-medium text-white transition-colors hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {calling ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  {calling ? 'Calling...' : 'Run Tool'}
                </button>
              </div>
            </>
          ) : prompt && selectedTab === 'prompts' ? (
            <>
              <div className="border-b border-border-1 px-4 py-3">
                <span className="truncate font-mono text-[13px] font-semibold text-text-1">{prompt.name}</span>
                {prompt.description && <p className="mt-1 text-[11px] text-text-3">{prompt.description}</p>}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {prompt.arguments.length > 0 ? prompt.arguments.map((arg) => (
                  <div key={arg.name}>
                    <label className="flex items-center gap-1 text-[11px] font-medium text-text-2">
                      {arg.name}
                      {arg.required && <span className="text-danger">*</span>}
                    </label>
                    {arg.description && <p className="mb-1 mt-0.5 text-[10px] text-text-4">{arg.description}</p>}
                    <input
                      value={promptArgs[arg.name] ?? ''}
                      onChange={(event) => setPromptArgs((current) => ({ ...current, [arg.name]: event.target.value }))}
                      className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                    />
                  </div>
                )) : (
                  <p className="text-[11px] text-text-4">This prompt does not declare arguments.</p>
                )}
              </div>
              {promptResult && (
                <div className="border-t border-border-1 p-3">
                  <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded border border-border-1 bg-surface-1 p-2 font-mono text-[11px] text-text-1">
                    {formatJSON(promptResult)}
                  </pre>
                </div>
              )}
              <div className="border-t border-border-1 p-3">
                <button
                  type="button"
                  onClick={handleGetPrompt}
                  disabled={gettingPrompt || status !== 'connected'}
                  className="flex h-8 w-full items-center justify-center gap-2 rounded bg-accent text-[11px] font-medium text-white transition-colors hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {gettingPrompt ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                  {gettingPrompt ? 'Getting...' : 'Get Prompt'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[11px] text-text-4">
              {status === 'connected' ? `Select a ${selectedTab === 'prompts' ? 'prompt' : 'tool'} to inspect it.` : 'Connect to an MCP server first.'}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
