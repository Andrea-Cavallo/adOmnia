import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, FolderOpen, Wand2 } from 'lucide-react'
import * as AppBinding from '@/wailsjs/go/main/App'
import * as MCPServerGenerator from '@/wailsjs/go/main/MCPServerGenerator'
import { useCollectionsStore } from '@/stores/collections'
import type { Collection, RequestAuth, RequestBody, RequestItem, TreeNode } from '@/lib/types'
import { cn } from '@/lib/utils'

interface GeneratorRequest {
  id: string
  name: string
  description: string
  method: string
  url: string
  auth: { type: string; token: string; key: string; value: string }
  body: { mode: string; raw: string }
}

function flattenRequests(nodes: TreeNode[]): RequestItem[] {
  const requests: RequestItem[] = []
  for (const node of nodes) {
    if (node.type === 'request') {
      requests.push(node)
    } else {
      requests.push(...flattenRequests(node.children))
    }
  }
  return requests
}

function activeBody(request: RequestItem): RequestBody {
  return request.bodies[request.activeBodyIdx] ?? request.bodies[0]
}

function authForGenerator(auth: RequestAuth): GeneratorRequest['auth'] {
  return {
    type: auth.type,
    token: auth.token ?? '',
    key: auth.username || 'X-API-Key',
    value: auth.token ?? '',
  }
}

function requestForGenerator(request: RequestItem): GeneratorRequest {
  const body = activeBody(request)
  return {
    id: request.id,
    name: request.name,
    description: request.description ?? '',
    method: request.method,
    url: request.url,
    auth: authForGenerator(request.auth),
    body: {
      mode: body?.type ?? 'none',
      raw: body?.raw ?? '',
    },
  }
}

export function McpServerGenPanel() {
  const collections = useCollectionsStore((state) => state.collections)
  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [serverName, setServerName] = useState('adomnia-api-server')
  const [outputDir, setOutputDir] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId) ?? null
  const requests = useMemo(() => selectedCollection ? flattenRequests(selectedCollection.children) : [], [selectedCollection])

  const toggleAll = () => {
    setSelectedIds((current) => current.size === requests.length ? new Set() : new Set(requests.map((request) => request.id)))
  }

  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handlePickDir = async () => {
    try {
      const dir = await AppBinding.SelectFolder('Choose MCP server output directory')
      if (dir) setOutputDir(dir)
    } catch {
      // Cancelled folder pickers should be quiet.
    }
  }

  const handleGenerate = async () => {
    if (!outputDir || selectedIds.size === 0) return
    setGenerating(true)
    setResult(null)
    try {
      const selected = requests.filter((request) => selectedIds.has(request.id)).map(requestForGenerator)
      const fallbackName = selectedCollection ? collectionServerName(selectedCollection) : 'adomnia-api-server'
      const inputJSON = JSON.stringify({ serverName: serverName.trim() || fallbackName, requests: selected })
      const errorMessage = await MCPServerGenerator.Generate(inputJSON, outputDir)
      if (errorMessage) {
        setResult({ success: false, message: errorMessage })
      } else {
        setResult({ success: true, message: `Server generated in ${outputDir}` })
      }
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-surface-0 p-4">
      <div>
        <h2 className="mb-1 text-[13px] font-semibold text-text-1">Generate MCP Server</h2>
        <p className="max-w-2xl text-[11px] text-text-3">
          Export selected collection endpoints as a local MCP server for AI assistants.
        </p>
      </div>

      <div className="grid max-w-3xl grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-text-2">Server Name</span>
          <input
            value={serverName}
            onChange={(event) => setServerName(event.target.value)}
            className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-text-2">Source Collection</span>
          <select
            value={selectedCollectionId}
            onChange={(event) => {
              setSelectedCollectionId(event.target.value)
              setSelectedIds(new Set())
              const collection = collections.find((item) => item.id === event.target.value)
              if (collection) setServerName(collectionServerName(collection))
            }}
            className="h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
          >
            <option value="">Select a collection</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>{collection.name}</option>
            ))}
          </select>
        </label>
      </div>

      {requests.length > 0 && (
        <div className="max-w-3xl">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-2">
              Endpoints ({selectedIds.size}/{requests.length})
            </span>
            <button type="button" onClick={toggleAll} className="text-[10px] text-accent hover:underline">
              {selectedIds.size === requests.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto rounded border border-border-1">
            {requests.map((request) => (
              <label key={request.id} className="flex cursor-pointer items-center gap-2 border-b border-border-0 px-3 py-2 last:border-b-0 hover:bg-surface-1">
                <input
                  type="checkbox"
                  checked={selectedIds.has(request.id)}
                  onChange={() => toggleOne(request.id)}
                  className="h-3 w-3 accent-[var(--color-accent)]"
                />
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px]', methodBadgeClass(request.method))}>
                  {request.method}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-1">{request.name}</span>
                <span className="max-w-[320px] truncate font-mono text-[10px] text-text-4">{request.url}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-3xl">
        <span className="mb-1 block text-[11px] font-medium text-text-2">Output Directory</span>
        <div className="flex gap-2">
          <input
            value={outputDir}
            onChange={(event) => setOutputDir(event.target.value)}
            placeholder="Choose or paste a local folder"
            className="h-8 flex-1 rounded border border-border-2 bg-surface-1 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
          />
          <button
            type="button"
            onClick={handlePickDir}
            className="flex h-8 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-3 text-[11px] text-text-2 transition-colors hover:bg-surface-3"
          >
            <FolderOpen size={12} />
            Browse
          </button>
        </div>
      </div>

      {result && (
        <div className={cn(
          'flex max-w-3xl items-start gap-2 rounded border px-3 py-2 text-[11px]',
          result.success ? 'border-success/30 bg-success/10 text-success' : 'border-error/30 bg-error/10 text-error',
        )}>
          {result.success ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating || !outputDir || selectedIds.size === 0}
        className="flex h-9 max-w-3xl items-center justify-center gap-2 rounded bg-accent text-[12px] font-medium text-white transition-colors hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Wand2 size={14} />
        {generating ? 'Generating...' : `Generate MCP Server (${selectedIds.size} tools)`}
      </button>
    </div>
  )
}

function collectionServerName(collection: Collection): string {
  return collection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'adomnia-api-server'
}

function methodBadgeClass(method: string): string {
  switch (method) {
    case 'GET':
      return 'bg-info/15 text-info'
    case 'POST':
      return 'bg-success/15 text-success'
    case 'PUT':
    case 'PATCH':
      return 'bg-warning/15 text-warning'
    case 'DELETE':
      return 'bg-error/15 text-error'
    default:
      return 'bg-surface-2 text-text-4'
  }
}
