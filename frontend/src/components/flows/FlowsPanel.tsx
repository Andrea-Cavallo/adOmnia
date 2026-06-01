import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Download,
  FileInput,
  FileJson,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import {
  DEFAULT_MERMAID_FLOW,
  graphFromMermaid,
  matchCatalogRequest,
  type ApiCatalogRequest,
} from '@/lib/flowMermaid'
import { runApiFlow, validateFlowGraph, type RunEntry, type RuntimeByNode } from '@/lib/flowRunner'
import {
  loadFlowDefinitions,
  saveFlowDefinitions,
  type FlowCondition,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type SavedFlowDefinition,
} from '@/lib/flowStorage'
import { FlowConnector, FlowInspector, FlowNodeCard, methodTone } from '@/components/flows/FlowGraphView'
import { type Collection, type RequestItem, type TreeNode, uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'

function normalizeName(text: string) {
  return text.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase()
}

function nodeOverrideKey(node: FlowNodeDefinition) {
  return node.mermaidKey || normalizeName(node.label)
}

function flattenRequests(collection: Collection): ApiCatalogRequest[] {
  const walk = (nodes: TreeNode[], path: string[]): ApiCatalogRequest[] => nodes.flatMap((node) => {
    if (node.type === 'folder') return walk(node.children, [...path, node.name])
    return [{
      id: `${collection.id}:${node.id}`,
      label: [...path, node.name].join(' / '),
      source: collection.name,
      request: node,
    }]
  })
  return walk(collection.children, [])
}

function requestOverridesFromGraph(graph: FlowGraphDefinition): Record<string, RequestItem> {
  return Object.fromEntries(graph.nodes
    .filter((node) => node.type === 'request' && node.config.request)
    .map((node) => [nodeOverrideKey(node), node.config.request as RequestItem]))
}

function conditionOverridesFromGraph(graph: FlowGraphDefinition): Record<string, FlowCondition> {
  return Object.fromEntries(graph.nodes
    .filter((node) => node.type === 'condition' && node.config.condition)
    .map((node) => [nodeOverrideKey(node), node.config.condition as FlowCondition]))
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportRunMarkdown(flowName: string, run: RunEntry[]) {
  const lines = [`# Flow run: ${flowName}`, '', `Generated: ${new Date().toISOString()}`, '']
  lines.push('| Step | Status | HTTP | Duration | Error |')
  lines.push('| --- | --- | ---: | ---: | --- |')
  run.forEach((entry) => {
    lines.push(`| ${entry.nodeLabel} | ${entry.status.toUpperCase()} | ${entry.httpStatus ?? '-'} | ${Math.round(entry.durationMs)}ms | ${(entry.error ?? '').replace(/\|/g, '\\|')} |`)
  })
  return lines.join('\n')
}

export function FlowsPanel() {
  const fileRef = useRef<HTMLInputElement>(null)
  const collections = useCollectionsStore((s) => s.collections)
  const envVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const catalog = useMemo(() => collections.flatMap(flattenRequests), [collections])
  const [flowName, setFlowName] = useState('Untitled API flow')
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)
  const [savedFlows, setSavedFlows] = useState<SavedFlowDefinition[]>([])
  const [mermaid, setMermaid] = useState(DEFAULT_MERMAID_FLOW)
  const [runtime, setRuntime] = useState<RuntimeByNode>({})
  const [lastRun, setLastRun] = useState<RunEntry[]>([])
  const [, setVars] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [requestOverrides, setRequestOverrides] = useState<Record<string, RequestItem>>({})
  const [conditionOverrides, setConditionOverrides] = useState<Record<string, FlowCondition>>({})

  useEffect(() => {
    let cancelled = false
    loadFlowDefinitions().then((flows) => {
      if (cancelled) return
      setSavedFlows(flows)
      const first = flows[0]
      if (first) {
        setActiveFlowId(first.id)
        setFlowName(first.name)
        setMermaid(first.mermaidSource || DEFAULT_MERMAID_FLOW)
        setRequestOverrides(requestOverridesFromGraph(first.graph))
        setConditionOverrides(conditionOverridesFromGraph(first.graph))
      }
    })
    return () => { cancelled = true }
  }, [])

  const graph = useMemo(() => {
    const next = graphFromMermaid(mermaid, catalog)
    return {
      ...next,
      nodes: next.nodes.map((node) => {
        const key = nodeOverrideKey(node)
        if (node.type === 'request' && requestOverrides[key]) {
          return { ...node, config: { ...node.config, request: { ...requestOverrides[key], id: uid(), name: node.label } } }
        }
        if (node.type === 'condition' && conditionOverrides[key]) {
          return { ...node, config: { ...node.config, condition: conditionOverrides[key] } }
        }
        return node
      }),
    }
  }, [catalog, conditionOverrides, mermaid, requestOverrides])
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes.find((node) => node.type === 'request') ?? graph.nodes[0] ?? null
  const validationErrors = useMemo(() => validateFlowGraph(graph), [graph])
  const savedSorted = useMemo(() => [...savedFlows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [savedFlows])
  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog.slice(0, 60)
    return catalog.filter((item) => `${item.label} ${item.source} ${item.request.method} ${item.request.url}`.toLowerCase().includes(q)).slice(0, 80)
  }, [catalog, search])

  const persist = async (next: SavedFlowDefinition[]) => {
    setSaveError('')
    setSavedFlows(next)
    try {
      setSavedFlows(await saveFlowDefinitions(next))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const saveFlow = () => {
    const id = activeFlowId ?? uid()
    const saved: SavedFlowDefinition = {
      id,
      name: flowName.trim() || 'Untitled API flow',
      graph,
      mermaidSource: mermaid,
      updatedAt: new Date().toISOString(),
      version: 3,
    }
    setActiveFlowId(id)
    setFlowName(saved.name)
    void persist([saved, ...savedFlows.filter((flow) => flow.id !== id)])
  }

  const newFlow = () => {
    setActiveFlowId(null)
    setFlowName('Untitled API flow')
    setMermaid(DEFAULT_MERMAID_FLOW)
    setRuntime({})
    setLastRun([])
    setVars({})
    setSelectedNodeId(null)
    setRequestOverrides({})
    setConditionOverrides({})
  }

  const loadFlow = (flow: SavedFlowDefinition) => {
    setActiveFlowId(flow.id)
    setFlowName(flow.name)
    setMermaid(flow.mermaidSource || DEFAULT_MERMAID_FLOW)
    setRequestOverrides(requestOverridesFromGraph(flow.graph))
    setConditionOverrides(conditionOverridesFromGraph(flow.graph))
    setRuntime({})
    setLastRun([])
    setVars({})
    setSelectedNodeId(null)
  }

  const deleteFlow = (id: string) => {
    void persist(savedFlows.filter((flow) => flow.id !== id))
    if (activeFlowId === id) newFlow()
  }

  const updateNodeRequest = (nodeId: string, request: RequestItem) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node) return
    setRequestOverrides((current) => ({ ...current, [nodeOverrideKey(node)]: request }))
  }

  const patchCondition = (nodeId: string, patch: Partial<FlowCondition>) => {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node || node.type !== 'condition') return
    setConditionOverrides((current) => ({
      ...current,
      [nodeOverrideKey(node)]: { ...(node.config.condition ?? { source: 'body', path: '', operator: 'eq', value: '' }), ...patch },
    }))
  }

  const runFlow = useCallback(async () => {
    if (running) return
    const errors = validateFlowGraph(graph)
    if (errors.length > 0) return
    setRunning(true)
    setLastRun([])
    try {
      await runApiFlow(graph, {
        initialVars: envVars(),
        onRuntime: setRuntime,
        onEntry: setLastRun,
        onVars: setVars,
        onSelectedNode: setSelectedNodeId,
      })
    } finally {
      setRunning(false)
    }
  }, [envVars, graph, running])

  const handleImport = async (file: File) => {
    const text = await file.text()
    setMermaid(text)
    setFlowName(file.name.replace(/\.(mmd|mermaid|txt)$/i, '') || 'Imported API flow')
    setActiveFlowId(null)
    setRuntime({})
    setLastRun([])
    setRequestOverrides({})
    setConditionOverrides({})
  }

  const exportJson = () => downloadBlob(JSON.stringify({ format: 'adomnia-flow', version: 3, definition: { name: flowName, graph, mermaidSource: mermaid }, lastRun }, null, 2), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}.json`, 'application/json')
  const exportRun = () => downloadBlob(exportRunMarkdown(flowName, lastRun), `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}-run.md`, 'text/markdown')

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] bg-surface-0">
      <aside className="flex min-h-0 flex-col border-r border-border-1 bg-surface-1">
        <div className="border-b border-border-1 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-2">
            <GitBranch size={14} className="text-accent" />
            Mermaid API Flow
          </div>
          <input
            value={flowName}
            onChange={(event) => setFlowName(event.target.value)}
            className="h-8 w-full rounded-md border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
            placeholder="Flow name"
          />
          {saveError && <div className="mt-2 rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error">{saveError}</div>}
        </div>

        <div className="grid grid-cols-5 gap-1 border-b border-border-1 p-2">
          <button onClick={newFlow} title="New flow" className="grid h-8 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"><Plus size={14} /></button>
          <button onClick={saveFlow} title="Save flow" className="grid h-8 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"><Save size={14} /></button>
          <button onClick={() => fileRef.current?.click()} title="Import Mermaid" className="grid h-8 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"><FileInput size={14} /></button>
          <button onClick={exportJson} title="Export flow JSON" className="grid h-8 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1"><FileJson size={14} /></button>
          <button onClick={exportRun} disabled={lastRun.length === 0} title="Export run report" className="grid h-8 place-items-center rounded border border-border-2 text-text-3 hover:text-text-1 disabled:opacity-40"><Download size={14} /></button>
          <input ref={fileRef} type="file" accept=".mmd,.mermaid,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImport(file); event.currentTarget.value = '' }} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border-1 p-2">
            <textarea
              value={mermaid}
              onChange={(event) => { setMermaid(event.target.value); setActiveFlowId(null); setRuntime({}); setLastRun([]) }}
              spellCheck={false}
              className="h-60 w-full resize-none rounded-md border border-border-2 bg-surface-0 p-3 font-mono text-[12px] leading-5 text-text-1 outline-none focus:border-accent"
              placeholder="flowchart TD&#10;    A[Login API] --> B[Get User Profile]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Saved flows</div>
            {savedSorted.map((flow) => (
              <div key={flow.id} className={cn('mb-1 flex items-center gap-1 rounded-md border px-2 py-1.5', flow.id === activeFlowId ? 'border-accent/60 bg-accent/10' : 'border-border-1 bg-surface-0')}>
                <button onClick={() => loadFlow(flow)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[11px] font-medium text-text-1">{flow.name}</div>
                  <div className="truncate text-[10px] text-text-4">{flow.graph.nodes.length} generated steps</div>
                </button>
                <button onClick={() => deleteFlow(flow.id)} title="Delete flow" className="grid h-6 w-6 place-items-center text-text-4 hover:text-error"><Trash2 size={12} /></button>
              </div>
            ))}
            {savedSorted.length === 0 && <div className="rounded border border-dashed border-border-2 px-3 py-4 text-[11px] text-text-4">Saved Mermaid flows stay local in this workspace.</div>}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-border-1 bg-surface-1 px-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-text-1">Generated executable flow</div>
            <div className="text-[10px] text-text-4">{graph.nodes.filter((node) => node.type === 'request').length} API steps from {catalog.length} catalog request{catalog.length === 1 ? '' : 's'}</div>
          </div>
          {validationErrors.length > 0 && (
            <div className="hidden max-w-[420px] items-center gap-2 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning xl:flex">
              <AlertTriangle size={13} />
              <span className="truncate">{validationErrors[0]}</span>
            </div>
          )}
          <button onClick={runFlow} disabled={running || validationErrors.length > 0} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45">
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {running ? 'Running' : 'Run flow'}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(460px,1fr)_340px]">
          <main className="min-h-0 overflow-auto bg-[linear-gradient(var(--color-border-1)_1px,transparent_1px),linear-gradient(90deg,var(--color-border-1)_1px,transparent_1px)] bg-[size:32px_32px] p-5">
            {graph.nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="max-w-sm rounded-md border border-dashed border-border-2 bg-surface-1 px-5 py-6 text-center">
                  <GitBranch size={26} className="mx-auto mb-3 text-text-4" />
                  <div className="text-sm font-semibold text-text-1">No flow generated yet</div>
                  <div className="mt-1 text-xs text-text-4">Paste or import a Mermaid flow on the left.</div>
                </div>
              </div>
            ) : (
              <div className="flex min-w-max items-center gap-3">
                {graph.nodes.map((node, index) => (
                  <div key={node.id} className="flex items-center gap-3">
                    <FlowNodeCard
                      node={node}
                      runtime={runtime[node.id]}
                      selected={selectedNode?.id === node.id}
                      match={node.type === 'request' ? matchCatalogRequest(node.label, catalog) : null}
                      onSelect={() => setSelectedNodeId(node.id)}
                    />
                    {index < graph.nodes.length - 1 && <FlowConnector graph={graph} node={node} />}
                  </div>
                ))}
              </div>
            )}

            {lastRun.length > 0 && (
              <div className="mt-6 overflow-hidden rounded-md border border-border-1 bg-surface-1">
                <div className="border-b border-border-1 px-3 py-2 text-xs font-semibold text-text-2">Run log</div>
                <div className="divide-y divide-border-1">
                  {lastRun.map((entry) => (
                    <button key={entry.id} onClick={() => setSelectedNodeId(entry.nodeId)} className="grid w-full grid-cols-[1fr_74px_72px_1.2fr] gap-3 px-3 py-2 text-left text-[11px] hover:bg-surface-2">
                      <span className="truncate text-text-2">{entry.nodeLabel}</span>
                      <span className={cn('font-semibold', entry.status === 'failed' ? 'text-error' : entry.status === 'success' ? 'text-success' : 'text-warning')}>{entry.status}</span>
                      <span className="font-mono text-text-4">{entry.httpStatus ?? '-'} / {Math.round(entry.durationMs)}ms</span>
                      <span className="truncate text-text-4">{entry.error ?? entry.response?.statusText ?? ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </main>

          <aside className="flex min-h-0 flex-col border-l border-border-1 bg-surface-1">
            <div className="border-b border-border-1 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">API catalog binding</div>
              <div className="flex h-8 items-center gap-2 rounded-md border border-border-2 bg-surface-0 px-2">
                <Search size={13} className="text-text-4" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find collection request..." className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4" />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selectedNode && <FlowInspector node={selectedNode} runtime={runtime[selectedNode.id]} onCondition={patchCondition} />}
              {selectedNode?.type === 'request' && (
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-4">Use real request</div>
                  <div className="space-y-1">
                    {filteredCatalog.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => updateNodeRequest(selectedNode.id, item.request)}
                        className="w-full rounded-md border border-border-1 bg-surface-0 px-2 py-2 text-left hover:border-accent/50 hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('font-mono text-[10px] font-bold', methodTone(item.request.method))}>{item.request.method}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-text-1">{item.label}</span>
                        </div>
                        <div className="mt-1 truncate text-[10px] text-text-4">{item.source} · {item.request.url || 'Missing URL'}</div>
                      </button>
                    ))}
                    {filteredCatalog.length === 0 && <div className="rounded border border-dashed border-border-2 px-3 py-4 text-[11px] text-text-4">No request found. Install APIs or create requests in API Workspace first.</div>}
                  </div>
                </div>
              )}

              {validationErrors.length > 0 && (
                <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning"><AlertTriangle size={13} /> Needs attention</div>
                  <div className="space-y-1 text-[11px] text-text-3">{validationErrors.map((error) => <div key={error}>{error}</div>)}</div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
