import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle2, GitBranch } from 'lucide-react'
import type { RequestBody } from '@/lib/types'
import { KVEditor } from './KVEditor'
import { JsonEditor } from '@/components/ui/JsonEditor'
import { JsonGraphModal } from '@/components/ui/JsonGraph'
import { cn } from '@/lib/utils'
import { useEnvironmentsStore } from '@/stores/environments'

interface BodyEditorProps {
  body: RequestBody
  onChange: (body: RequestBody) => void
  isWebSocket?: boolean
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
  const [error, setError] = useState('')
  const [showGraph, setShowGraph] = useState(false)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const resolvedVars = getResolvedVars()
  const unresolvedVars = Array.from(new Set(
    Array.from((body.raw ?? '').matchAll(/\{\{([^}]+)\}\}/g))
      .map((m) => m[1].trim())
      .filter((name) => !activeEnvId || !resolvedVars[name]),
  ))

  const prettify = () => {
    try {
      const p = JSON.stringify(JSON.parse(body.raw ?? ''), null, 2)
      onChange({ ...body, raw: p })
      setError('')
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
    try { JSON.parse(v); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid JSON') }
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2 flex-1">
      <div className="flex items-center gap-2">
        <button
          onClick={prettify}
          className="px-2 py-0.5 text-[10px] text-accent hover:text-accent-light rounded hover:bg-accent/10 transition-colors"
        >
          Prettify
        </button>
        <button
          onClick={() => setShowGraph(true)}
          disabled={!!error || !(body.raw ?? '').trim()}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-3 hover:text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:hover:text-text-3"
          title="Open JSON graph"
        >
          <GitBranch size={11} /> Graph
        </button>
        {error
          ? <AlertCircle size={12} className="text-error" />
          : (body.raw ?? '').trim() && <CheckCircle2 size={12} className="text-success" />
        }
      </div>
      <JsonEditor
        value={body.raw ?? ''}
        onChange={handleChange}
        placeholder={'{\n  "key": "value"\n}'}
        error={error}
        className="flex-1"
        minHeight="280px"
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
      {error && <p className="text-[10px] text-error font-mono px-1">{error}</p>}
      {showGraph && <JsonGraphModal title="Request Body JSON Graph" json={body.raw} onClose={() => setShowGraph(false)} />}
    </div>
  )
}

function GraphQLEditor({ body, onChange }: { body: RequestBody; onChange: (b: RequestBody) => void }) {
  const [varsOpen, setVarsOpen] = useState(true)

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
      <button
        onClick={() => setVarsOpen(v => !v)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-4 hover:text-text-2 px-1"
      >
        {varsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Variables (JSON)
      </button>
      {varsOpen && (
        <textarea
          className="min-h-[80px] p-3 bg-surface-2 border border-border-2 rounded font-mono text-xs text-text-1 placeholder:text-text-4 resize-y focus:border-accent outline-none"
          placeholder={'{\n  "id": "123"\n}'}
          value={body.graphqlVariables ?? ''}
          onChange={e => onChange({ ...body, graphqlVariables: e.target.value })}
          spellCheck={false}
        />
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

export function BodyEditor({ body, onChange, isWebSocket }: BodyEditorProps) {
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
        <GraphQLEditor body={body} onChange={onChange} />
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
