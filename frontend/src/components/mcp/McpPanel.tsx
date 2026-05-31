import { useState, useCallback } from 'react'
import { Plug, PlugZap, RefreshCw, Wrench, Play, AlertCircle, ChevronRight } from 'lucide-react'
import * as MCPClient from '@/wailsjs/go/main/MCPClient'
import { cn } from '@/lib/utils'

interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

function parseJSON<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T } catch { return fallback }
}

export function McpPanel() {
  const [serverConfig, setServerConfig] = useState('{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [tools, setTools] = useState<MCPTool[]>([])
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  const [toolArgs, setToolArgs] = useState('{}')
  const [toolResult, setToolResult] = useState('')
  const [calling, setCalling] = useState(false)
  const [error, setError] = useState('')
  const [connectInfo, setConnectInfo] = useState('')

  const handleConnect = async () => {
    setError('')
    setConnecting(true)
    setConnectInfo('')
    try {
      const info = await MCPClient.Connect(serverConfig)
      setConnectInfo(info)
      setConnected(true)
      await refreshTools()
    } catch (e) {
      setError(String(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setError('')
    try {
      await MCPClient.Disconnect()
    } catch { /* ignore */ }
    setConnected(false)
    setTools([])
    setSelectedTool(null)
    setToolResult('')
    setConnectInfo('')
  }

  const refreshTools = useCallback(async () => {
    setError('')
    try {
      const raw = await MCPClient.ListTools()
      const parsed = parseJSON<{ tools?: MCPTool[] } | MCPTool[]>(raw, [])
      const list = Array.isArray(parsed) ? parsed : (parsed as { tools?: MCPTool[] }).tools ?? []
      setTools(list)
      if (list.length > 0 && !selectedTool) {
        setSelectedTool(list[0])
        setToolArgs(JSON.stringify(list[0].inputSchema ?? {}, null, 2))
      }
    } catch (e) {
      setError(String(e))
    }
  }, [selectedTool])

  const handleCallTool = async () => {
    if (!selectedTool) return
    setError('')
    setCalling(true)
    setToolResult('')
    try {
      const result = await MCPClient.CallTool(selectedTool.name, toolArgs)
      setToolResult(result)
    } catch (e) {
      setError(String(e))
    } finally {
      setCalling(false)
    }
  }

  const selectTool = (tool: MCPTool) => {
    setSelectedTool(tool)
    setToolArgs(JSON.stringify(tool.inputSchema ?? {}, null, 2))
    setToolResult('')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
        <PlugZap size={16} className="text-accent" />
        <span className="text-sm font-semibold text-text-1">MCP Client</span>
        <div className="flex-1" />
        {connected && (
          <button
            onClick={refreshTools}
            className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors"
            title="Refresh tools"
          >
            <RefreshCw size={13} />
          </button>
        )}
        <button
          onClick={connected ? handleDisconnect : handleConnect}
          disabled={connecting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40',
            connected
              ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30'
              : 'bg-accent text-white hover:bg-accent-light'
          )}
        >
          {connecting ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : connected ? (
            <Plug size={12} />
          ) : (
            <PlugZap size={12} />
          )}
          {connecting ? 'Connecting…' : connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* Server config */}
      {!connected && (
        <div className="px-4 pt-4 pb-2 flex-shrink-0">
          <label className="text-xs font-semibold text-text-3 uppercase tracking-wider block mb-2">Server Config (JSON)</label>
          <textarea
            className="w-full h-28 px-2.5 py-2 bg-surface-2 border border-border-1 rounded text-xs font-mono text-text-1 placeholder-text-3 outline-none focus:border-accent resize-none"
            value={serverConfig}
            onChange={e => setServerConfig(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {/* Connect info */}
      {connectInfo && (
        <div className="mx-4 mb-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400 flex-shrink-0">
          {connectInfo}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 flex-shrink-0">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Main — two columns when connected */}
      {connected && (
        <div className="flex flex-1 overflow-hidden">
          {/* Tools list */}
          <div className="w-56 border-r border-border-1 flex flex-col overflow-hidden flex-shrink-0">
            <div className="px-3 py-2 border-b border-border-1 bg-surface-1 flex-shrink-0">
              <span className="text-xs font-semibold text-text-3 uppercase tracking-wider">Tools ({tools.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tools.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-text-3 px-4 text-center">
                  No tools available
                </div>
              ) : (
                tools.map(tool => (
                  <button
                    key={tool.name}
                    onClick={() => selectTool(tool)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-border-1/50 hover:bg-surface-2 transition-colors',
                      selectedTool?.name === tool.name && 'bg-accent/10 border-l-2 border-l-accent pl-2.5'
                    )}
                  >
                    <Wrench size={12} className="text-text-3 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-text-1 truncate">{tool.name}</p>
                      {tool.description && (
                        <p className="text-xs text-text-3 truncate">{tool.description}</p>
                      )}
                    </div>
                    <ChevronRight size={10} className="text-text-3 flex-shrink-0 ml-auto" />
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Tool invocation */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedTool ? (
              <>
                <div className="px-4 py-3 border-b border-border-1 bg-surface-1 flex-shrink-0 flex items-center gap-2">
                  <Wrench size={13} className="text-accent" />
                  <span className="text-sm font-semibold text-text-1">{selectedTool.name}</span>
                  {selectedTool.description && (
                    <span className="text-xs text-text-3 ml-1">— {selectedTool.description}</span>
                  )}
                </div>
                <div className="flex flex-col flex-1 overflow-hidden gap-0">
                  {/* Args */}
                  <div className="flex flex-col flex-1 overflow-hidden p-4 gap-2">
                    <label className="text-xs font-semibold text-text-3 uppercase tracking-wider">Arguments (JSON)</label>
                    <textarea
                      className="flex-1 px-2.5 py-2 bg-surface-2 border border-border-1 rounded text-xs font-mono text-text-1 outline-none focus:border-accent resize-none"
                      value={toolArgs}
                      onChange={e => setToolArgs(e.target.value)}
                      spellCheck={false}
                    />
                    <button
                      onClick={handleCallTool}
                      disabled={calling}
                      className="self-start flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
                    >
                      {calling ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />}
                      {calling ? 'Calling…' : 'Call Tool'}
                    </button>
                  </div>

                  {/* Result */}
                  {toolResult && (
                    <div className="border-t border-border-1 p-4 flex flex-col gap-2 max-h-64">
                      <label className="text-xs font-semibold text-text-3 uppercase tracking-wider">Result</label>
                      <pre className="flex-1 overflow-auto bg-surface-2 border border-border-1 rounded p-2.5 text-xs font-mono text-text-2 whitespace-pre-wrap">{toolResult}</pre>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-text-3">
                Select a tool from the list
              </div>
            )}
          </div>
        </div>
      )}

      {!connected && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center max-w-sm px-4">
            <PlugZap size={32} className="text-text-3" />
            <p className="text-sm font-medium text-text-1">Connect to an MCP server</p>
            <p className="text-xs text-text-3">Configure the server JSON above and click Connect to browse and invoke tools.</p>
          </div>
        </div>
      )}
    </div>
  )
}
