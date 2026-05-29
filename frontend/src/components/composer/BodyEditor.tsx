import { useState, useEffect, useMemo } from 'react'
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, GitBranch, Database, Loader2, RefreshCw } from 'lucide-react'
import type { RequestBody } from '@/lib/types'
import { KVEditor } from './KVEditor'
import { JsonEditor } from '@/components/ui/JsonEditor'
import { JsonGraphModal } from '@/components/ui/JsonGraph'
import { cn } from '@/lib/utils'
import { diagnoseJson } from '@/lib/jsonDiagnostics'
import { useEnvironmentsStore } from '@/stores/environments'

interface BodyEditorProps {
  body: RequestBody
  onChange: (body: RequestBody) => void
  isWebSocket?: boolean
  requestUrl?: string
  requestMethod?: string
}

// ── GraphQL introspection types ──────────────────────────────────────────────

interface GQLTypeRef {
  kind: string
  name?: string
  ofType?: GQLTypeRef
}

interface GQLFieldArg {
  name: string
  type: GQLTypeRef
}

interface GQLField {
  name: string
  description?: string
  args: GQLFieldArg[]
  type: GQLTypeRef
}

interface GQLType {
  name: string
  kind: string
  description?: string
  fields?: GQLField[]
  enumValues?: { name: string; description?: string }[]
}

interface GQLIntrospectionResult {
  __schema: {
    queryType: { name: string } | null
    mutationType: { name: string } | null
    subscriptionType: { name: string } | null
    types: GQLType[]
  }
}

const GRAPHQL_INTROSPECTION_QUERY = `{
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      name
      kind
      description
      fields(includeDeprecated: false) { name description args { name type { name kind ofType { name kind ofType { name kind } } } } type { name kind ofType { name kind ofType { name kind } } } }
      enumValues { name description }
    }
  }
}`

function gqlTypeString(t: GQLTypeRef): string {
  if (t.name) return t.name
  if (t.ofType) {
    if (t.kind === 'LIST') return `[${gqlTypeString(t.ofType)}]`
    if (t.kind === 'NON_NULL') return `${gqlTypeString(t.ofType)}!`
  }
  return t.kind
}

const ALL_BODY_TYPES = [
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'raw' },
  { id: 'urlencoded', label: 'form-urlencoded' },
  { id: 'formdata', label: 'form-data' },
  { id: 'graphql', label: 'GraphQL' },
] as const

const WS_BODY_TYPES = [
  { id: 'json', label: 'JSON' },
  { id: 'raw', label: 'raw' },
] as const

type BodyTypeId = 'json' | 'raw' | 'urlencoded' | 'formdata' | 'graphql'

const RAW_LANGUAGES = [
  { id: 'xml', label: 'XML' },
  { id: 'text', label: 'Text' },
  { id: 'html', label: 'HTML' },
  { id: 'javascript', label: 'JS' },
] as const

function JsonRawEditor({ body, onChange }: { body: RequestBody; onChange: (b: RequestBody) => void }) {
  const [showGraph, setShowGraph] = useState(false)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const resolvedVars = getResolvedVars()
  const diagnostics = useMemo(() => diagnoseJson(body.raw ?? ''), [body.raw])
  const hasContent = !!(body.raw ?? '').trim()
  const hasErrors = diagnostics.length > 0
  const unresolvedVars = Array.from(new Set(
    Array.from((body.raw ?? '').matchAll(/\{\{([^}]+)\}\}/g))
      .map((m) => m[1].trim())
      .filter((name) => !activeEnvId || !resolvedVars[name]),
  ))

  const prettify = () => {
    try {
      const p = JSON.stringify(JSON.parse(body.raw ?? ''), null, 2)
      onChange({ ...body, raw: p })
    } catch { /* keep as is */ }
  }

  // Auto-beautify on mount if content is valid JSON
  useEffect(() => {
    if (!(body.raw ?? '').trim()) return
    try {
      const p = JSON.stringify(JSON.parse(body.raw ?? ''), null, 2)
      if (p !== body.raw) onChange({ ...body, raw: p })
    } catch { /* not valid JSON, leave as is */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id])

  const handleChange = (v: string) => {
    onChange({ ...body, raw: v })
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2 flex-1 min-h-0">
      <div className="flex items-center gap-2">
        <button
          onClick={prettify}
          className="px-2 py-0.5 text-[10px] text-accent hover:text-accent-light rounded hover:bg-accent/10 transition-colors"
        >
          Prettify
        </button>
        <button
          onClick={() => setShowGraph(true)}
          disabled={hasErrors || !hasContent}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-3 hover:text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:hover:text-text-3"
          title="Open JSON graph"
        >
          <GitBranch size={11} /> Graph
        </button>
        {hasErrors
          ? <AlertCircle size={12} className="text-error" />
          : hasContent && <CheckCircle2 size={12} className="text-success" />
        }
        {hasErrors && (
          <span className="text-[10px] font-mono text-error">
            {diagnostics.length} {diagnostics.length === 1 ? 'issue' : 'issues'}
          </span>
        )}
      </div>
      <JsonEditor
        value={body.raw ?? ''}
        onChange={handleChange}
        placeholder={'{\n  "key": "value"\n}'}
        error={hasErrors ? 'Invalid JSON' : undefined}
        className="flex-1"
        minHeight="280px"
        resolvedVars={resolvedVars}
        hasActiveEnv={!!activeEnvId}
      />
      {unresolvedVars.length > 0 && (
        <div className={cn(
          'rounded border px-2 py-1 text-[10px] font-mono',
          activeEnvId ? 'border-error/35 bg-error/8 text-error' : 'border-warning/35 bg-warning/8 text-warning',
        )}>
          {activeEnvId ? 'Unresolved variables: ' : 'No active environment for variables: '}
          {unresolvedVars.slice(0, 8).map((name) => `{{${name}}}`).join(', ')}
          {unresolvedVars.length > 8 ? ` +${unresolvedVars.length - 8} more` : ''}
        </div>
      )}
      {hasErrors && (
        <div className="rounded border border-error/35 bg-error/8 px-2 py-1.5 font-mono text-[10px] text-error">
          <p className="mb-1 font-semibold">Malformed JSON because:</p>
          <ol className="max-h-32 list-decimal space-y-0.5 overflow-y-auto pl-4 pr-1">
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.index}:${diagnostic.message}`}>
                <span className="text-text-3">Line {diagnostic.line}, column {diagnostic.column}:</span>{' '}
                {diagnostic.message}
              </li>
            ))}
          </ol>
        </div>
      )}
      {showGraph && <JsonGraphModal title="Request Body JSON Graph" json={body.raw} onClose={() => setShowGraph(false)} />}
    </div>
  )
}

function GraphQLEditor({ body, onChange, requestUrl }: { body: RequestBody; onChange: (b: RequestBody) => void; requestUrl?: string }) {
  const [varsOpen, setVarsOpen] = useState(true)
  const [schema, setSchema] = useState<GQLIntrospectionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSchema, setShowSchema] = useState(false)

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const introspect = async () => {
    if (!requestUrl) { setError('No request URL configured'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }),
      })
      if (!res.ok) {
        const text = await res.text()
        setError(`HTTP ${res.status}: ${text.slice(0, 200)}`)
        return
      }
      const json = await res.json()
      if (json.errors && json.errors.length) {
        setError(json.errors[0].message ?? 'Introspection failed')
        return
      }
      setSchema(json.data)
      setShowSchema(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const typeMap = useMemo(() => {
    if (!schema) return new Map<string, GQLType>()
    const m = new Map<string, GQLType>()
    for (const t of schema.__schema.types) m.set(t.name, t)
    return m
  }, [schema])

  const rootTypes = useMemo(() => {
    if (!schema) return []
    const result: { label: string; type: GQLType | undefined }[] = []
    const s = schema.__schema
    if (s.queryType) result.push({ label: 'Query', type: typeMap.get(s.queryType.name) })
    if (s.mutationType) result.push({ label: 'Mutation', type: typeMap.get(s.mutationType.name) })
    if (s.subscriptionType) result.push({ label: 'Subscription', type: typeMap.get(s.subscriptionType.name) })
    return result
  }, [schema, typeMap])

  const insertField = (path: string) => {
    onChange({ ...body, raw: (body.raw ?? '') + path })
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <label className="text-[10px] uppercase tracking-wider text-text-4 px-1">Query</label>
      <textarea
        className="min-h-[140px] p-3 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-y focus:border-accent outline-none"
        placeholder={"query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n    email\n  }\n}"}
        value={body.raw ?? ''}
        onChange={e => onChange({ ...body, raw: e.target.value })}
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => setVarsOpen(v => !v)}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-4 hover:text-text-2 px-1"
        >
          {varsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Variables (JSON)
        </button>
        {!schema && (
          <button
            onClick={introspect}
            disabled={loading || !requestUrl}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 size={10} className="animate-spin" /> : <Database size={10} />}
            Load Schema
          </button>
        )}
        {schema && (
          <>
            <button
              onClick={() => setShowSchema(s => !s)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
            >
              {showSchema ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Schema Explorer
            </button>
            <button
              onClick={introspect}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-4 hover:text-text-2 transition-colors"
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => { setSchema(null); setShowSchema(false); }}
              className="text-[10px] text-text-4 hover:text-error transition-colors"
            >
              Clear
            </button>
          </>
        )}
      </div>
      {varsOpen && (
        <textarea
          className="min-h-[80px] p-3 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-y focus:border-accent outline-none"
          placeholder={'{\n  "id": "123"\n}'}
          value={body.graphqlVariables ?? ''}
          onChange={e => onChange({ ...body, graphqlVariables: e.target.value })}
          spellCheck={false}
        />
      )}
      {error && (
        <div className="px-2 py-1.5 rounded border border-error/30 bg-error/8 text-[11px] text-error font-mono">{error}</div>
      )}
      {showSchema && schema && (
        <div className="border border-border-2 rounded bg-surface-1 max-h-[400px] overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-border-2 text-[10px] text-text-4 font-medium uppercase tracking-wider">
            Schema
          </div>
          {rootTypes.map(rt => rt.type && (
            <div key={rt.label}>
              <button
                onClick={() => toggleExpand(rt.label)}
                className="flex items-center gap-1 w-full px-3 py-1 hover:bg-surface-2 text-left transition-colors"
              >
                {expanded.has(rt.label) ? <ChevronDown size={10} className="text-text-4" /> : <ChevronRight size={10} className="text-text-4" />}
                <span className="text-[11px] font-semibold text-text-2">{rt.label}</span>
                <span className="text-[9px] text-accent ml-auto">{rt.type.fields?.length ?? 0} fields</span>
              </button>
              {expanded.has(rt.label) && rt.type.fields?.map(f => (
                <div key={f.name} className="pl-5 pr-2">
                  <button
                    onClick={() => insertField(f.name)}
                    className="flex items-center gap-1 w-full py-1 hover:bg-surface-2 text-left group transition-colors rounded"
                  >
                    <span className="text-[11px] text-text-2 font-mono group-hover:text-accent cursor-pointer">{f.name}</span>
                    {f.args.length > 0 && (
                      <span className="text-[9px] text-text-4">({f.args.map(a => `${a.name}: ${gqlTypeString(a.type)}`).join(', ')})</span>
                    )}
                    <span className="text-[9px] text-accent ml-auto">: {gqlTypeString(f.type)}</span>
                  </button>
                </div>
              ))}
            </div>
          ))}
          {rootTypes.filter(rt => !rt.type).length > 0 && (
            <p className="px-3 py-2 text-[10px] text-text-4 italic">No root types found</p>
          )}
        </div>
      )}
    </div>
  )
}

function RawEditor({ body, onChange }: { body: RequestBody; onChange: (b: RequestBody) => void }) {
  const [error, setError] = useState('')

  const validate = (v: string) => {
    if (body.lang !== 'json') { setError(''); return }
    try { JSON.parse(v); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Invalid') }
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <div className="flex items-center gap-1">
        {RAW_LANGUAGES.map(l => (
          <button
            key={l.id}
            onClick={() => onChange({ ...body, lang: l.id })}
            className={cn('px-2 py-0.5 text-[10px] rounded', body.lang === l.id ? 'bg-surface-3 text-text-1' : 'text-text-4 hover:text-text-2')}
          >
            {l.label}
          </button>
        ))}
        {error
          ? <AlertCircle size={12} className="ml-auto text-error" />
          : (body.raw ?? '').trim() && <CheckCircle2 size={12} className="ml-auto text-success" />
        }
      </div>
      <textarea
        className={cn(
          'min-h-[280px] p-3 bg-surface-2 border rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-y focus:border-accent outline-none',
          error ? 'border-error/60' : 'border-border-2'
        )}
        placeholder={
          body.lang === 'xml' ? '<root>\n  <item>value</item>\n</root>' :
          body.lang === 'html' ? '<html>…</html>' : 'body content…'
        }
        value={body.raw ?? ''}
        onChange={e => { onChange({ ...body, raw: e.target.value }); validate(e.target.value) }}
        spellCheck={false}
      />
      {error && <p className="text-[10px] text-error font-mono px-1">{error}</p>}
    </div>
  )
}

export function BodyEditor({ body, onChange, isWebSocket, requestUrl }: BodyEditorProps) {
  const BODY_TYPES = isWebSocket ? WS_BODY_TYPES : ALL_BODY_TYPES

  const activeType: BodyTypeId = body.type === 'raw' && body.lang === 'json' ? 'json'
    : body.type === 'raw' ? 'raw'
    : body.type as BodyTypeId

  const handleTypeChange = (id: BodyTypeId) => {
    if (id === 'json') {
      let raw = body.raw ?? ''
      try { raw = raw.trim() ? JSON.stringify(JSON.parse(raw), null, 2) : raw } catch { /* keep user text */ }
      onChange({ ...body, type: 'raw', lang: 'json', raw })
    }
    else if (id === 'raw') onChange({ ...body, type: 'raw', lang: body.lang === 'json' ? 'xml' : body.lang })
    else onChange({ ...body, type: id as RequestBody['type'] })
  }

  return (
    <div className="flex flex-col flex-1 pt-1 min-h-0">
      <div className="flex items-center gap-0.5 px-2 pb-1 flex-wrap">
        {BODY_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => handleTypeChange(t.id)}
            className={cn(
              'px-2 py-1 text-xs rounded transition-colors',
              activeType === t.id
                ? 'bg-accent/20 text-accent-light border border-accent/40'
                : 'text-text-3 hover:text-text-1 border border-transparent'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {body.type === 'none' && (
        <p className="px-3 py-4 text-xs text-text-4 italic">This request has no body.</p>
      )}

      {body.type === 'raw' && body.lang === 'json' && (
        <JsonRawEditor body={body} onChange={onChange} />
      )}

      {body.type === 'raw' && body.lang !== 'json' && (
        <RawEditor body={body} onChange={onChange} />
      )}

      {body.type === 'graphql' && (
        <GraphQLEditor body={body} onChange={onChange} requestUrl={requestUrl} />
      )}

      {(body.type === 'urlencoded' || body.type === 'formdata') && (
        <div className="pb-2">
          {body.type === 'formdata' && (
            <p className="px-3 pb-1 text-[10px] text-text-4">
              Multipart form-data — each row is a separate field
            </p>
          )}
          <KVEditor rows={body.form ?? []} onChange={form => onChange({ ...body, form })} />
        </div>
      )}
    </div>
  )
}
