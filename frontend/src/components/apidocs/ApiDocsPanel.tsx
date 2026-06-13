import { useRef, useState } from 'react'
import { BookOpen, Boxes, Link2, ClipboardPaste, AlertCircle, Loader2, X } from 'lucide-react'
import { useCollectionsStore } from '@/stores/collections'
import { collectionsToOAS } from '@/lib/oasExport'
import { executeRequest } from '@/lib/executeRequest'
import { blankRequest } from '@/lib/types'
import { parseSpecText, buildApiDocModel, type ApiDocModel } from '@/lib/apidocs/parseSpec'
import { ApiDocsViewer } from './ApiDocsViewer'

type SourceTab = 'collection' | 'url' | 'paste'

export function ApiDocsPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const [model, setModel] = useState<ApiDocModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<SourceTab>('collection')
  const [selectedCollection, setSelectedCollection] = useState('__all__')
  const [url, setUrl] = useState('')
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = (raw: string) => {
    setError(null)
    try {
      const spec = parseSpecText(raw)
      const built = buildApiDocModel(spec)
      if (built.operationCount === 0) {
        setError('Parsed the document but found no operations (paths). Is this an OpenAPI/Swagger spec?')
        return
      }
      setModel(built)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not parse the document')
    }
  }

  const generateFromCollections = () => {
    const source = selectedCollection === '__all__'
      ? collections
      : collections.filter((c) => c.id === selectedCollection)
    if (source.length === 0) {
      setError('No collection selected.')
      return
    }
    try {
      load(collectionsToOAS(source, 'json'))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not generate spec from collection')
    }
  }

  const loadFromUrl = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const req = { ...blankRequest('GET', 'OpenAPI spec'), url: url.trim() }
      const { response } = await executeRequest(req, {})
      if (response.error) {
        setError(`Request failed: ${response.error.message}`)
        return
      }
      if (!response.body) {
        setError(`Empty response (status ${response.status}).`)
        return
      }
      load(response.body)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not fetch the spec')
    } finally {
      setLoading(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    setPasteText(text)
    load(text)
  }

  if (model) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border-1 bg-surface-1 px-3 py-1.5">
          <BookOpen size={14} className="text-accent" />
          <span className="text-[12px] font-medium text-text-2">API Docs</span>
          <button
            onClick={() => setModel(null)}
            className="ml-auto flex items-center gap-1 rounded-md border border-border-2 px-2 py-1 text-[11px] text-text-3 hover:text-text-1"
          >
            <X size={12} /> Load another
          </button>
        </div>
        <ApiDocsViewer model={model} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-surface-0 p-6">
      <div className="w-full max-w-xl rounded-xl border border-border-1 bg-surface-1 p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <BookOpen size={18} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-1">API Docs / Swagger viewer</h2>
        </div>
        <p className="mb-4 text-[12px] text-text-3">
          Read-only reference for an OpenAPI 3 or Swagger 2.0 spec — grouped by tag with
          parameters, request/response schemas, and examples.
        </p>

        <div className="mb-4 flex gap-1 rounded-lg border border-border-2 bg-surface-0 p-1">
          <TabButton active={tab === 'collection'} onClick={() => setTab('collection')} icon={<Boxes size={13} />} label="From collection" />
          <TabButton active={tab === 'url'} onClick={() => setTab('url')} icon={<Link2 size={13} />} label="From URL" />
          <TabButton active={tab === 'paste'} onClick={() => setTab('paste')} icon={<ClipboardPaste size={13} />} label="Paste / file" />
        </div>

        {tab === 'collection' && (
          <div className="space-y-2">
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              className="h-9 w-full rounded-md border border-border-2 bg-surface-2 px-2 text-[12px] text-text-1 outline-none focus:border-accent"
            >
              <option value="__all__">All collections ({collections.length})</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={generateFromCollections} className="h-9 w-full rounded-md bg-accent text-[12px] font-bold text-white hover:bg-accent-hover">
              Generate docs
            </button>
          </div>
        )}

        {tab === 'url' && (
          <div className="space-y-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadFromUrl() }}
              placeholder="https://api.example.com/openapi.json"
              className="h-9 w-full rounded-md border border-border-2 bg-surface-2 px-2.5 text-[12px] text-text-1 outline-none focus:border-accent"
            />
            <button onClick={loadFromUrl} disabled={loading} className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent text-[12px] font-bold text-white hover:bg-accent-hover disabled:opacity-50">
              {loading && <Loader2 size={13} className="animate-spin" />} Fetch & render
            </button>
            <p className="text-[11px] text-text-4">Fetched through adOmnia's request engine (no browser CORS limits).</p>
          </div>
        )}

        {tab === 'paste' && (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste an OpenAPI/Swagger JSON or YAML document…"
              className="h-40 w-full resize-none rounded-md border border-border-2 bg-surface-2 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button onClick={() => load(pasteText)} disabled={!pasteText.trim()} className="h-9 flex-1 rounded-md bg-accent text-[12px] font-bold text-white hover:bg-accent-hover disabled:opacity-50">
                Render
              </button>
              <button onClick={() => fileRef.current?.click()} className="h-9 rounded-md border border-border-2 px-3 text-[12px] text-text-2 hover:text-text-1">
                Open file…
              </button>
              <input ref={fileRef} type="file" accept=".json,.yaml,.yml,application/json,text/yaml" className="hidden" onChange={handleFile} />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
        active ? 'bg-accent/15 text-accent' : 'text-text-3 hover:bg-surface-2 hover:text-text-1'
      }`}
    >
      {icon} {label}
    </button>
  )
}
