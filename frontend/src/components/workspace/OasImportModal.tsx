import { useRef, useState } from 'react'
import { X, Upload, Link as LinkIcon, FileText, AlertCircle } from 'lucide-react'
import { openApiToCollection } from '@/lib/openapiImport'
import { useCollectionsStore } from '@/stores/collections'
import { cn } from '@/lib/utils'

interface Props {
  onClose: () => void
  onImported?: (name: string) => void
}

type ImportTab = 'file' | 'url' | 'paste'

const TABS: { id: ImportTab; label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'url', label: 'URL' },
  { id: 'paste', label: 'Paste' },
]

export function OasImportModal({ onClose, onImported }: Props) {
  const [tab, setTab] = useState<ImportTab>('file')
  const [url, setUrl] = useState('')
  const [paste, setPaste] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importCollection = useCollectionsStore((s) => s.importCollection)

  const doImport = (specText: string) => {
    setError('')
    setLoading(true)
    try {
      const collection = openApiToCollection(specText)
      importCollection(collection)
      onImported?.(collection.name)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      doImport(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleURL = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    try {
      const resp = await fetch(url.trim())
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
      const text = await resp.text()
      doImport(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] bg-surface-1 border border-border-1 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-1">
          <span className="text-xs font-semibold text-text-1">Import OpenAPI Spec</span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-text-4 hover:text-text-1 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-1 px-4 gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError('') }}
              className={cn(
                'px-3 py-2 text-[11px] border-b-2 transition-colors',
                tab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-4 space-y-3">
          {tab === 'file' && (
            <div className="space-y-3">
              <p className="text-[11px] text-text-3">Open an OpenAPI 3.x (.yaml / .json) or Swagger 2.x file from disk.</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".yaml,.yml,.json"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="w-full h-9 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                <Upload size={13} /> Choose File…
              </button>
            </div>
          )}

          {tab === 'url' && (
            <div className="space-y-3">
              <p className="text-[11px] text-text-3">Fetch a spec from a URL (requires network access).</p>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleURL() }}
                placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
                className="w-full h-7 px-2 text-[11px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
              />
              <button
                onClick={() => void handleURL()}
                disabled={loading || !url.trim()}
                className="w-full h-9 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                <LinkIcon size={13} /> {loading ? 'Fetching…' : 'Import from URL'}
              </button>
            </div>
          )}

          {tab === 'paste' && (
            <div className="space-y-3">
              <p className="text-[11px] text-text-3">Paste YAML or JSON spec content directly.</p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={'openapi: 3.1.0\ninfo:\n  title: My API\n  version: 1.0.0\npaths: {}'}
                rows={8}
                className="w-full px-2 py-1.5 text-[11px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-none"
              />
              <button
                onClick={() => paste.trim() && doImport(paste.trim())}
                disabled={loading || !paste.trim()}
                className="w-full h-9 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                <FileText size={13} /> {loading ? 'Importing…' : 'Import'}
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded bg-error/10 border border-error/30 text-[11px] text-error">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
