import { useState } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { serverUrl, sidecarFetch, useServerPort } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'

export const STARTER_SCHEMA = `{
  "type": "object",
  "required": ["id", "name", "email"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "name": { "type": "string", "format": "name" },
    "email": { "type": "string", "format": "email" },
    "active": { "type": "boolean" },
    "roles": {
      "type": "array",
      "items": { "type": "string", "enum": ["admin", "editor", "viewer"] }
    }
  }
}`

interface MockSchemaEditorProps {
  value: string
  onChange: (value: string) => void
}

export function MockSchemaEditor({ value, onChange }: MockSchemaEditorProps) {
  const port = useServerPort()
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const schema = value || STARTER_SCHEMA

  const handlePreview = async () => {
    const url = serverUrl(port, '/mock/preview-schema')
    if (!url) return

    setLoading(true)
    setError('')
    try {
      const res = await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
      })
      const text = await res.text()
      if (!res.ok) {
        try {
          const parsed = JSON.parse(text)
          setError(parsed.error || parsed.message || text)
        } catch {
          setError(text || 'Schema preview failed')
        }
        setPreview('')
        return
      }
      setPreview(JSON.stringify(JSON.parse(text), null, 2))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Schema preview failed')
      setPreview('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-1 grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-2">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-4">JSON Schema</span>
          <button
            onClick={() => onChange(STARTER_SCHEMA)}
            className="flex items-center gap-1 text-[10px] text-text-4 hover:text-accent"
            type="button"
          >
            <Wand2 size={10} /> Starter
          </button>
        </div>
        <textarea
          value={schema}
          onChange={(event) => onChange(event.target.value)}
          rows={12}
          className="w-full min-h-[180px] px-2.5 py-2 bg-surface-2 border border-border-2 rounded text-[11px] text-text-1 font-mono outline-none focus:border-accent resize-y leading-relaxed"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-4">Live preview</span>
          <button
            onClick={handlePreview}
            disabled={loading || !port}
            className={cn(
              'flex items-center gap-1 text-[10px] text-accent hover:text-accent-light disabled:opacity-40',
              loading && 'text-text-4',
            )}
            type="button"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Generate
          </button>
        </div>
        <pre className="min-h-[180px] max-h-[340px] overflow-auto rounded border border-border-2 bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-text-1 font-mono">
          {preview || 'Generate a sample response from the schema.'}
        </pre>
        {error && <p className="text-[10px] text-error">{error}</p>}
      </div>
    </div>
  )
}
