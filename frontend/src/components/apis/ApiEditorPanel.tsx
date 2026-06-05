import { useState } from 'react'
import { Plus } from 'lucide-react'
import { parse, stringify } from 'yaml'
import { useCollectionsStore } from '@/stores/collections'
import { collectionToOAS } from '@/lib/oasExport'
import { EndpointFormEditor, type EndpointDef } from './EndpointFormEditor'
import type { OASParam } from './ParameterTable'
import { cn } from '@/lib/utils'

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-head',
}

type OASDoc = {
  openapi?: string
  info?: { title?: string; version?: string }
  paths?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

function safeParse(spec: string): OASDoc | null {
  try {
    const doc = parse(spec) as OASDoc
    return doc && typeof doc === 'object' ? doc : null
  } catch {
    return null
  }
}

function specToEndpointList(spec: string): Array<{ method: string; path: string; summary: string }> {
  const doc = safeParse(spec)
  if (!doc?.paths) return []
  const result: Array<{ method: string; path: string; summary: string }> = []
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, { summary?: string }>)) {
      result.push({ method: method.toUpperCase(), path, summary: op?.summary ?? '' })
    }
  }
  return result
}

function specToEndpointDef(spec: string, method: string, path: string): EndpointDef {
  const blank: EndpointDef = {
    method,
    path,
    summary: '',
    description: '',
    pathParams: [],
    queryParams: [],
    headerParams: [],
    hasRequestBody: false,
    requestBodyContentType: 'application/json',
    requestBodySchema: '',
    responses: [{ statusCode: '200', description: 'OK', schema: '' }],
  }
  const doc = safeParse(spec)
  const op = (doc?.paths?.[path]?.[method.toLowerCase()] as Record<string, unknown>) ?? null
  if (!op) return blank

  blank.summary = (op.summary as string) ?? ''
  blank.description = (op.description as string) ?? ''

  const params = (op.parameters as Array<Record<string, unknown>>) ?? []
  const mapParam = (p: Record<string, unknown>, where: OASParam['in']): OASParam => ({
    name: (p.name as string) ?? '',
    in: where,
    required: where === 'path' ? true : ((p.required as boolean) ?? false),
    type: (p.schema as { type?: string })?.type ?? 'string',
    description: (p.description as string) ?? '',
  })
  blank.pathParams = params.filter((p) => p.in === 'path').map((p) => mapParam(p, 'path'))
  blank.queryParams = params.filter((p) => p.in === 'query').map((p) => mapParam(p, 'query'))
  blank.headerParams = params.filter((p) => p.in === 'header').map((p) => mapParam(p, 'header'))

  const rb = op.requestBody as Record<string, unknown> | undefined
  if (rb) {
    blank.hasRequestBody = true
    const content = (rb.content as Record<string, { schema?: unknown }>) ?? {}
    const ct = Object.keys(content)[0] ?? 'application/json'
    blank.requestBodyContentType = ct
    blank.requestBodySchema = JSON.stringify(content[ct]?.schema ?? {}, null, 2)
  }

  const responses = (op.responses as Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>) ?? {}
  const respEntries = Object.entries(responses)
  if (respEntries.length > 0) {
    blank.responses = respEntries.map(([code, r]) => ({
      statusCode: code,
      description: r.description ?? '',
      schema: r.content ? JSON.stringify(Object.values(r.content)[0]?.schema ?? {}, null, 2) : '',
    }))
  }
  return blank
}

/** Parse a JSON schema string, returning an empty object schema on failure. */
function parseSchema(raw: string): unknown {
  if (!raw.trim()) return { type: 'object' }
  try {
    return JSON.parse(raw)
  } catch {
    return { type: 'object' }
  }
}

/** Build an OAS operation object from the form definition. */
function endpointDefToOperation(def: EndpointDef): Record<string, unknown> {
  const parameters = [...def.pathParams, ...def.queryParams, ...def.headerParams]
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.in === 'path' ? true : p.required,
      schema: { type: p.type },
      ...(p.description ? { description: p.description } : {}),
    }))

  const op: Record<string, unknown> = {}
  if (def.summary) op.summary = def.summary
  if (def.description) op.description = def.description
  if (parameters.length) op.parameters = parameters

  if (def.hasRequestBody) {
    op.requestBody = {
      required: true,
      content: { [def.requestBodyContentType]: { schema: parseSchema(def.requestBodySchema) } },
    }
  }

  const responses: Record<string, unknown> = {}
  for (const r of def.responses) {
    const code = r.statusCode.trim() || '200'
    responses[code] = {
      description: r.description || '',
      ...(r.schema.trim() ? { content: { 'application/json': { schema: parseSchema(r.schema) } } } : {}),
    }
  }
  op.responses = Object.keys(responses).length ? responses : { '200': { description: 'OK' } }
  return op
}

export function ApiEditorPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const updateCollection = useCollectionsStore((s) => s.updateCollection)

  const [selectedCollectionId, setSelectedCollectionId] = useState('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<{ method: string; path: string } | null>(null)

  const collection = collections.find((c) => c.id === selectedCollectionId)
  // Derive the live spec: stored _openapiSpec wins, otherwise synthesize from collection requests.
  const liveSpec = collection ? (collection._openapiSpec || collectionToOAS(collection, 'yaml')) : ''
  const endpoints = liveSpec ? specToEndpointList(liveSpec) : []

  const endpointDef =
    selectedEndpoint && liveSpec ? specToEndpointDef(liveSpec, selectedEndpoint.method, selectedEndpoint.path) : null

  const persistSpec = (doc: OASDoc) => {
    if (!collection) return
    updateCollection(collection.id, { _openapiSpec: stringify(doc, { lineWidth: 0 }) })
  }

  const handleSave = (updated: EndpointDef) => {
    if (!collection) return
    const doc: OASDoc = safeParse(liveSpec) ?? {
      openapi: '3.0.3',
      info: { title: collection.name, version: '1.0.0' },
      paths: {},
    }
    doc.paths = doc.paths ?? {}

    // If method/path changed, drop the original operation.
    if (selectedEndpoint && (selectedEndpoint.path !== updated.path || selectedEndpoint.method !== updated.method)) {
      const oldMethods = doc.paths[selectedEndpoint.path]
      if (oldMethods) {
        delete oldMethods[selectedEndpoint.method.toLowerCase()]
        if (Object.keys(oldMethods).length === 0) delete doc.paths[selectedEndpoint.path]
      }
    }

    const methodsForPath = doc.paths[updated.path] ?? {}
    methodsForPath[updated.method.toLowerCase()] = endpointDefToOperation(updated)
    doc.paths[updated.path] = methodsForPath

    persistSpec(doc)
    setSelectedEndpoint({ method: updated.method, path: updated.path })
  }

  const handleNewEndpoint = () => {
    if (!collection) return
    const newPath = '/new-endpoint'
    const doc: OASDoc = safeParse(liveSpec) ?? {
      openapi: '3.0.3',
      info: { title: collection.name, version: '1.0.0' },
      paths: {},
    }
    doc.paths = doc.paths ?? {}
    const methodsForPath = doc.paths[newPath] ?? {}
    if (!methodsForPath['get']) {
      methodsForPath['get'] = { summary: 'New endpoint', responses: { '200': { description: 'OK' } } }
    }
    doc.paths[newPath] = methodsForPath
    persistSpec(doc)
    setSelectedEndpoint({ method: 'GET', path: newPath })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: collection + endpoint list */}
      <div className="w-[220px] border-r border-border-1 flex flex-col bg-surface-0">
        <div className="p-2 border-b border-border-1">
          <select
            value={selectedCollectionId}
            onChange={(e) => {
              setSelectedCollectionId(e.target.value)
              setSelectedEndpoint(null)
            }}
            className="w-full h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
          >
            <option value="">— Select collection —</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {endpoints.map((ep) => (
            <button
              key={`${ep.method}:${ep.path}`}
              onClick={() => setSelectedEndpoint({ method: ep.method, path: ep.path })}
              className={cn(
                'w-full text-left flex items-center gap-2 px-3 py-2 transition-colors',
                selectedEndpoint?.method === ep.method && selectedEndpoint?.path === ep.path
                  ? 'bg-accent/10'
                  : 'hover:bg-surface-1',
              )}
            >
              <span className={cn('text-[8px] font-mono font-bold shrink-0 w-8', METHOD_COLORS[ep.method] ?? 'text-text-4')}>
                {ep.method.slice(0, 4)}
              </span>
              <span className="text-[10px] font-mono text-text-1 truncate">{ep.path}</span>
            </button>
          ))}
          {endpoints.length === 0 && selectedCollectionId && (
            <p className="px-3 py-3 text-[10px] text-text-4 text-center">
              No endpoints yet.
              <br />
              Add one below.
            </p>
          )}
        </div>

        {selectedCollectionId && (
          <div className="p-2 border-t border-border-1">
            <button
              onClick={handleNewEndpoint}
              className="w-full h-7 flex items-center justify-center gap-1.5 text-[10px] bg-surface-2 text-text-3 rounded hover:bg-surface-3 hover:text-text-1 transition-colors"
            >
              <Plus size={12} />
              New Endpoint
            </button>
          </div>
        )}
      </div>

      {/* Right: form editor */}
      {endpointDef ? (
        <EndpointFormEditor endpoint={endpointDef} onSave={handleSave} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[10px] text-text-4">
          {selectedCollectionId ? 'Select an endpoint to edit it.' : 'Select a collection to start editing.'}
        </div>
      )}
    </div>
  )
}
