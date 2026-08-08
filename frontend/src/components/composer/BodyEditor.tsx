import { useState, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, AlertCircle, CheckCircle2, GitBranch, Database, Loader2, RefreshCw, Search, X, Braces, FileText, Link2, Files, Share2, Maximize2, Minimize2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RequestBody } from '@/lib/types'
import { KVEditor } from './KVEditor'
import { JsonEditor } from '@/components/ui/JsonEditor'
import { JsonGraphModal } from '@/components/ui/JsonGraph'
import { cn } from '@/lib/utils'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { diagnoseJson } from '@/lib/jsonDiagnostics'
import { prettyJson } from '@/lib/prettyJson'
import { findTextMatches } from '@/lib/textSearch'
import { useEnvironmentsStore } from '@/stores/environments'
import { useGraphqlCacheStore } from '@/stores/graphqlCache'

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
  { id: 'json', label: 'JSON', title: 'JSON payload' },
  { id: 'raw', label: 'Raw', title: 'Raw text payload' },
  { id: 'urlencoded', label: 'URL Encoded', title: 'application/x-www-form-urlencoded' },
  { id: 'formdata', label: 'Form Data', title: 'multipart/form-data' },
  { id: 'graphql', label: 'GraphQL', title: 'GraphQL query and variables' },
] as const

const WS_BODY_TYPES = [
  { id: 'json', label: 'JSON', title: 'JSON payload' },
  { id: 'raw', label: 'Raw', title: 'Raw text payload' },
] as const

type BodyTypeId = 'json' | 'raw' | 'urlencoded' | 'formdata' | 'graphql'

const BODY_ICONS: Record<BodyTypeId, LucideIcon> = {
  json: Braces,
  raw: FileText,
  urlencoded: Link2,
  formdata: Files,
  graphql: Share2,
}

const RAW_LANGUAGES = [
  { id: 'xml', label: 'XML' },
  { id: 'text', label: 'Text' },
  { id: 'html', label: 'HTML' },
  { id: 'javascript', label: 'JS' },
] as const

interface BodySearchState {
  query: string
  activeIndex: number
  matchCase: boolean
  wholeWord: boolean
}

// Reads the textarea's live value (not a prop) so callers can depend only on
// the search state — editing a matched value must not re-fire this and yank the
// caret back to the search hit. See [[bug: ctrl-f focus returns to key]].
function selectTextareaMatch(textarea: HTMLTextAreaElement | null, search: BodySearchState) {
  const { query, activeIndex, matchCase, wholeWord } = search
  if (!textarea || !query) return
  const text = textarea.value
  const matches = findTextMatches(text, query, { matchCase, wholeWord })
  const start = matches[activeIndex]
  if (start === undefined) return
  const end = start + query.length
  textarea.setSelectionRange(start, end)
  const line = text.slice(0, start).split('\n').length - 1
  const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 19
  textarea.scrollTop = Math.max(0, line * lineHeight - 72)
}

function BodyFindBar({
  open,
  query,
  matches,
  activeIndex,
  inputRef,
  onOpen,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
  matchCase,
  wholeWord,
  onMatchCaseChange,
  onWholeWordChange,
}: {
  open: boolean
  query: string
  matches: number
  activeIndex: number
  inputRef: MutableRefObject<HTMLInputElement | null>
  onOpen: () => void
  onQueryChange: (value: string) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  matchCase: boolean
  wholeWord: boolean
  onMatchCaseChange: () => void
  onWholeWordChange: () => void
}) {
  const tr = useUiTranslation()
  if (!open) {
    return (
      <button
        onClick={onOpen}
        title={tr('Find in body')}
        className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
      >
        <Search size={13} />
      </button>
    )
  }

  return (
    <div className="ml-auto flex h-7 items-center overflow-hidden rounded border border-border-2 bg-surface-2">
      <Search size={12} className="ml-2 shrink-0 text-text-4" />
      <input
        ref={(node) => { inputRef.current = node }}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) onPrev()
            else onNext()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        placeholder={tr('Find body')}
        className="h-full w-40 bg-transparent px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4"
      />
      <span className="min-w-14 px-1 text-center font-mono text-[10px] text-text-4">
        {query ? `${matches ? activeIndex + 1 : 0}/${matches}` : '0/0'}
      </span>
      <button
        onClick={onMatchCaseChange}
        aria-pressed={matchCase}
        title={tr('Match case')}
        className={cn('flex h-full min-w-7 items-center justify-center px-1 font-mono text-[10px] font-semibold', matchCase ? 'bg-accent/15 text-accent' : 'text-text-4 hover:text-text-1')}
      >
        Aa
      </button>
      <button
        onClick={onWholeWordChange}
        aria-pressed={wholeWord}
        title={tr('Match whole word')}
        className={cn('flex h-full min-w-7 items-center justify-center px-1 font-mono text-[10px] font-semibold', wholeWord ? 'bg-accent/15 text-accent' : 'text-text-4 hover:text-text-1')}
      >
        Ab
      </button>
      <button onClick={onPrev} disabled={!matches} title={tr('Previous match')} className="flex h-full w-6 items-center justify-center text-text-4 hover:text-text-1 disabled:opacity-35">
        <ChevronUp size={12} />
      </button>
      <button onClick={onNext} disabled={!matches} title={tr('Next match')} className="flex h-full w-6 items-center justify-center text-text-4 hover:text-text-1 disabled:opacity-35">
        <ChevronDown size={12} />
      </button>
      <button onClick={onClose} title={tr('Close find')} className="flex h-full w-7 items-center justify-center text-text-4 hover:text-text-1">
        <X size={12} />
      </button>
    </div>
  )
}

function JsonRawEditor({ body, onChange, search }: { body: RequestBody; onChange: (b: RequestBody) => void; search: BodySearchState }) {
  const tr = useUiTranslation()
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
      const p = prettyJson(body.raw ?? '')
      onChange({ ...body, raw: p })
    } catch { /* keep as is */ }
  }

  // Auto-beautify on mount if content is valid JSON
  useEffect(() => {
    if (!(body.raw ?? '').trim()) return
    try {
      const p = prettyJson(body.raw ?? '')
      if (p !== body.raw) onChange({ ...body, raw: p })
    } catch { /* not valid JSON, leave as is */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.id])

  const handleChange = (v: string) => {
    onChange({ ...body, raw: v })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <div className="-mx-3 flex min-h-10 items-center gap-2 border-b border-border-2 bg-surface-0/70 px-3">
        <button
          onClick={prettify}
          className="rounded px-2 py-1 text-[10.5px] font-medium text-accent outline-none transition-colors hover:bg-accent/10 hover:text-accent-light focus-visible:ring-2 focus-visible:ring-accent"
        >
          {tr('Beautify')}
        </button>
        <button
          onClick={() => setShowGraph(true)}
          disabled={hasErrors || !hasContent}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium text-text-2 outline-none transition-colors hover:bg-accent/10 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:text-text-3"
          title={tr('Open JSON graph')}
        >
          <GitBranch size={11} /> {tr('Graph')}
        </button>
        {hasErrors
          ? <AlertCircle size={12} className="text-error" />
          : hasContent && <CheckCircle2 size={12} className="text-success" />
        }
        {!hasErrors && hasContent && <span className="text-[10px] font-medium text-success">{tr('Valid JSON')}</span>}
        {hasErrors && (
          <span className="text-[10px] font-mono text-error">
            {diagnostics.length} {diagnostics.length === 1 ? tr('issue') : tr('issues')}
          </span>
        )}
      </div>
      <JsonEditor
        value={body.raw ?? ''}
        onChange={handleChange}
        placeholder={'{\n  "key": "value"\n}'}
        error={hasErrors ? tr('Invalid JSON') : undefined}
        className="flex-1"
        minHeight="280px"
        resolvedVars={resolvedVars}
        hasActiveEnv={!!activeEnvId}
        searchTerm={search.query}
        activeSearchIndex={search.activeIndex}
        searchMatchCase={search.matchCase}
        searchWholeWord={search.wholeWord}
      />
      {unresolvedVars.length > 0 && (
        <div className={cn(
          'rounded border px-2 py-1 text-[10px] font-mono',
          activeEnvId ? 'border-error/35 bg-error/8 text-error' : 'border-warning/35 bg-warning/8 text-warning',
        )}>
          {activeEnvId ? tr('Unresolved variables: ') : tr('No active environment for variables: ')}
          {unresolvedVars.slice(0, 8).map((name) => `{{${name}}}`).join(', ')}
          {unresolvedVars.length > 8 ? ` +${unresolvedVars.length - 8} ${tr('more')}` : ''}
        </div>
      )}
      {hasErrors && (
        <div className="rounded border border-error/35 bg-error/8 px-2 py-1.5 font-mono text-[10px] text-error">
          <p className="mb-1 font-semibold">{tr('Malformed JSON because:')}</p>
          <ol className="max-h-32 list-decimal space-y-0.5 overflow-y-auto pl-4 pr-1">
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.index}:${diagnostic.message}`}>
                <span className="text-text-3">{tr('Line')} {diagnostic.line}, {tr('column')} {diagnostic.column}:</span>{' '}
                {diagnostic.message}
              </li>
            ))}
          </ol>
        </div>
      )}
      {showGraph && (
        <JsonGraphModal
          title={tr('Request Body JSON Graph')}
          json={body.raw}
          onChange={(raw) => onChange({ ...body, raw })}
          onClose={() => setShowGraph(false)}
        />
      )}
    </div>
  )
}

function GraphQLEditor({ body, onChange, requestUrl, search }: { body: RequestBody; onChange: (b: RequestBody) => void; requestUrl?: string; search: BodySearchState }) {
  const tr = useUiTranslation()
  const [varsOpen, setVarsOpen] = useState(true)
  const [schema, setSchema] = useState<GQLIntrospectionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showSchema, setShowSchema] = useState(false)

  const loadCache          = useGraphqlCacheStore((s) => s.load)
  const cacheLoaded        = useGraphqlCacheStore((s) => s.loaded)
  const getCacheEntry      = useGraphqlCacheStore((s) => s.getEntry)
  const setCachedSchema    = useGraphqlCacheStore((s) => s.setSchema)
  const setCachedVariables = useGraphqlCacheStore((s) => s.setVariables)
  const clearCachedSchema  = useGraphqlCacheStore((s) => s.clearSchema)
  const restoredVarsRef    = useRef(false)
  const queryRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    selectTextareaMatch(queryRef.current, search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Hydrate the persistent introspection cache once.
  useEffect(() => { void loadCache() }, [loadCache])

  // Restore a cached schema + last variables for this endpoint so they survive
  // tab close/reopen and app restart without a re-fetch.
  useEffect(() => {
    if (!cacheLoaded || !requestUrl) return
    const entry = getCacheEntry(requestUrl)
    if (!entry) return
    if (!schema && entry.schema) {
      setSchema(entry.schema as GQLIntrospectionResult)
      setShowSchema(true)
    }
    if (!restoredVarsRef.current && !(body.graphqlVariables ?? '').trim() && (entry.variables ?? '').trim()) {
      restoredVarsRef.current = true
      onChange({ ...body, graphqlVariables: entry.variables })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheLoaded, requestUrl])

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const introspect = async () => {
    if (!requestUrl) { setError(tr('No request URL configured')); return }
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
        setError(json.errors[0].message ?? tr('Introspection failed'))
        return
      }
      setSchema(json.data)
      setShowSchema(true)
      setCachedSchema(requestUrl, json.data)
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
    if (s.queryType) result.push({ label: tr('Query'), type: typeMap.get(s.queryType.name) })
    if (s.mutationType) result.push({ label: tr('Mutation'), type: typeMap.get(s.mutationType.name) })
    if (s.subscriptionType) result.push({ label: tr('Subscription'), type: typeMap.get(s.subscriptionType.name) })
    return result
  }, [schema, tr, typeMap])

  const insertField = (path: string) => {
    onChange({ ...body, raw: (body.raw ?? '') + path })
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <label className="text-[10px] uppercase tracking-wider text-text-4 px-1">{tr('Query')}</label>
      <textarea
        ref={queryRef}
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
          {tr('Variables (JSON)')}
        </button>
        {!schema && (
          <button
            onClick={introspect}
            disabled={loading || !requestUrl}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 size={10} className="animate-spin" /> : <Database size={10} />}
            {tr('Load Schema')}
          </button>
        )}
        {schema && (
          <>
            <button
              onClick={() => setShowSchema(s => !s)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
            >
              {showSchema ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {tr('Schema Explorer')}
            </button>
            <button
              onClick={introspect}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-4 hover:text-text-2 transition-colors"
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => { setSchema(null); setShowSchema(false); if (requestUrl) clearCachedSchema(requestUrl) }}
              className="text-[10px] text-text-4 hover:text-error transition-colors"
            >
              {tr('Clear')}
            </button>
          </>
        )}
      </div>
      {varsOpen && (
        <textarea
          className="min-h-[80px] p-3 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-y focus:border-accent outline-none"
          placeholder={'{\n  "id": "123"\n}'}
          value={body.graphqlVariables ?? ''}
          onChange={e => { onChange({ ...body, graphqlVariables: e.target.value }); if (requestUrl) setCachedVariables(requestUrl, e.target.value) }}
          spellCheck={false}
        />
      )}
      {error && (
        <div className="px-2 py-1.5 rounded border border-error/30 bg-error/8 text-[11px] text-error font-mono">{error}</div>
      )}
      {showSchema && schema && (
        <div className="border border-border-2 rounded bg-surface-1 max-h-[400px] overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-border-2 text-[10px] text-text-4 font-medium uppercase tracking-wider">
            {tr('Schema')}
          </div>
          {rootTypes.map(rt => rt.type && (
            <div key={rt.label}>
              <button
                onClick={() => toggleExpand(rt.label)}
                className="flex items-center gap-1 w-full px-3 py-1 hover:bg-surface-2 text-left transition-colors"
              >
                {expanded.has(rt.label) ? <ChevronDown size={10} className="text-text-4" /> : <ChevronRight size={10} className="text-text-4" />}
                <span className="text-[11px] font-semibold text-text-2">{rt.label}</span>
                <span className="text-[9px] text-accent ml-auto">{rt.type.fields?.length ?? 0} {tr('fields')}</span>
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
            <p className="px-3 py-2 text-[10px] text-text-4 italic">{tr('No root types found')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function RawEditor({ body, onChange, search }: { body: RequestBody; onChange: (b: RequestBody) => void; search: BodySearchState }) {
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    selectTextareaMatch(textareaRef.current, search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

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
        ref={textareaRef}
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
  const tr = useUiTranslation()
  const BODY_TYPES = isWebSocket ? WS_BODY_TYPES : ALL_BODY_TYPES
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState<BodySearchState>({ query: '', activeIndex: 0, matchCase: false, wholeWord: false })
  const [maximized, setMaximized] = useState(false)
  const findInputRef = useRef<HTMLInputElement>(null)
  const editorRootRef = useRef<HTMLDivElement>(null)

  const activeType: BodyTypeId = body.type === 'raw' && body.lang === 'json' ? 'json'
    : body.type === 'raw' ? 'raw'
    : body.type as BodyTypeId

  const handleTypeChange = (id: BodyTypeId) => {
    if (id === 'json') {
      let raw = body.raw ?? ''
      try { raw = raw.trim() ? prettyJson(raw) : raw } catch { /* keep user text */ }
      onChange({ ...body, type: 'raw', lang: 'json', raw })
    }
    else if (id === 'raw') onChange({ ...body, type: 'raw', lang: body.lang === 'json' ? 'xml' : body.lang })
    else onChange({ ...body, type: id as RequestBody['type'] })
  }

  const searchableBodyText = useMemo(() => {
    if (body.type === 'raw' || body.type === 'graphql') return body.raw ?? ''
    if (body.type === 'urlencoded' || body.type === 'formdata') {
      return (body.form ?? []).map((row) => `${row.key}\n${row.value}`).join('\n')
    }
    return ''
  }, [body.form, body.raw, body.type])

  const bodyMatches = useMemo(
    () => findTextMatches(searchableBodyText, search.query, search),
    [search, searchableBodyText],
  )

  useEffect(() => {
    if (search.activeIndex < bodyMatches.length || bodyMatches.length === 0) return
    setSearch((current) => ({ ...current, activeIndex: 0 }))
  }, [bodyMatches.length, search.activeIndex])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (!editorRootRef.current?.contains(event.target as Node)) return
        event.preventDefault()
        setSearchOpen(true)
        requestAnimationFrame(() => findInputRef.current?.focus())
        return
      }
      if (event.key === 'Escape' && maximized) { event.preventDefault(); setMaximized(false) }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [maximized])

  const openFind = () => {
    setSearchOpen(true)
    requestAnimationFrame(() => findInputRef.current?.focus())
  }

  const closeFind = () => {
    setSearchOpen(false)
    // Removing the query also removes highlights and tells the active editor
    // to collapse the search selection back to a normal caret.
    setSearch((current) => ({ ...current, query: '', activeIndex: 0 }))
  }

  const nextMatch = () => {
    if (!bodyMatches.length) return
    setSearch((current) => ({ ...current, activeIndex: (current.activeIndex + 1) % bodyMatches.length }))
  }

  const prevMatch = () => {
    if (!bodyMatches.length) return
    setSearch((current) => ({ ...current, activeIndex: (current.activeIndex - 1 + bodyMatches.length) % bodyMatches.length }))
  }

  return (
    <>
      {maximized && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setMaximized(false)}
        />
      )}
      <div className={cn(
        'flex min-h-0 flex-col bg-surface-0',
        maximized
          ? 'fixed inset-3 z-50 overflow-hidden rounded-xl border border-border-2 shadow-2xl'
          : 'flex-1',
      )} ref={editorRootRef}>
      <section className="flex flex-nowrap items-center justify-between gap-2 border-b border-border-2 bg-surface-1 px-3 py-2.5">
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div role="radiogroup" aria-label={tr('Body format')} className="inline-flex flex-nowrap items-center gap-0.5 rounded-lg bg-surface-0 p-1 ring-1 ring-inset ring-border-2">
            {BODY_TYPES.map((type) => {
              const active = activeType === type.id
              const Icon = BODY_ICONS[type.id]
              return (
                <button
                  key={type.id}
                  onClick={() => handleTypeChange(type.id)}
                  title={tr(type.title as UiMessage)}
                  role="radio"
                  aria-checked={active}
                  className={cn(
                    'group inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'bg-accent text-white shadow-[0_2px_10px_-2px_var(--color-accent-glow)]'
                      : 'text-text-3 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  <Icon size={12} className={active ? 'text-white/90' : 'text-text-4 group-hover:text-text-2'} />
                  {tr(type.label as UiMessage)}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <BodyFindBar
            open={searchOpen}
            query={search.query}
            matches={bodyMatches.length}
            activeIndex={Math.min(search.activeIndex, Math.max(bodyMatches.length - 1, 0))}
            inputRef={findInputRef}
            onOpen={openFind}
            onQueryChange={(query) => setSearch((current) => ({ ...current, query, activeIndex: 0 }))}
            onPrev={prevMatch}
            onNext={nextMatch}
            onClose={closeFind}
            matchCase={search.matchCase}
            wholeWord={search.wholeWord}
            onMatchCaseChange={() => setSearch((current) => ({ ...current, matchCase: !current.matchCase, activeIndex: 0 }))}
            onWholeWordChange={() => setSearch((current) => ({ ...current, wholeWord: !current.wholeWord, activeIndex: 0 }))}
          />
          <button
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? tr('Exit full screen (Esc)') : tr('Expand body to full screen')}
            aria-pressed={maximized}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 outline-none transition-colors hover:bg-surface-2 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </section>

      {body.type === 'none' && (
        <p className="px-3 py-4 text-xs text-text-4 italic">{tr('This request has no body.')}</p>
      )}

      {body.type === 'raw' && body.lang === 'json' && (
        <JsonRawEditor body={body} onChange={onChange} search={search} />
      )}

      {body.type === 'raw' && body.lang !== 'json' && (
        <RawEditor body={body} onChange={onChange} search={search} />
      )}

      {body.type === 'graphql' && (
        <GraphQLEditor body={body} onChange={onChange} requestUrl={requestUrl} search={search} />
      )}

      {(body.type === 'urlencoded' || body.type === 'formdata') && (
        <div className="pb-2">
          {body.type === 'formdata' && (
            <p className="px-3 pb-1 text-[10px] text-text-4">
              {tr('Multipart form-data — each row is a separate field')}
            </p>
          )}
          <KVEditor rows={body.form ?? []} onChange={form => onChange({ ...body, form })} />
        </div>
      )}
      </div>
    </>
  )
}
