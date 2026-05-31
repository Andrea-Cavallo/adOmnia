import { useState } from 'react'
import { Sparkles, X, RefreshCw, Download, AlertCircle } from 'lucide-react'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { uid } from '@/lib/types'

interface GeneratedEndpoint {
  path: string
  method: string
  statusCode: number
  headers: Record<string, string>
  body: string
  delayMs: number
}

interface ImportableEndpoint {
  id: string
  path: string
  method: string
  description: string
  responses: {
    id: string
    name: string
    status: number
    headers: Record<string, string>
    body: string
    delayMs: number
    isActive: boolean
  }[]
  mode: string
  enabled: boolean
}

function toImportable(ep: GeneratedEndpoint): ImportableEndpoint {
  return {
    id: uid(),
    path: ep.path,
    method: ep.method.toUpperCase(),
    description: `Generated: ${ep.method.toUpperCase()} ${ep.path}`,
    responses: [
      {
        id: uid(),
        name: 'AI Response',
        status: ep.statusCode || 200,
        headers: ep.headers ?? { 'Content-Type': 'application/json' },
        body: ep.body ?? '{}',
        delayMs: ep.delayMs ?? 0,
        isActive: true,
      },
    ],
    mode: 'first_active',
    enabled: true,
  }
}

const INPUT_TYPES = [
  { value: 'natural', label: 'Natural language', placeholder: 'Describe the API: "A REST API for a todo app with users and tasks"' },
  { value: 'json', label: 'JSON example', placeholder: 'Paste example request/response JSON to generate mock endpoints' },
  { value: 'openapi', label: 'OpenAPI spec', placeholder: 'Paste an OpenAPI 3.x spec fragment (YAML or JSON)' },
]

interface Props {
  onClose: () => void
  onImport: (endpoints: ImportableEndpoint[]) => void
}

export function AiMockDialog({ onClose, onImport }: Props) {
  const [inputType, setInputType] = useState<'natural' | 'json' | 'openapi'>('natural')
  const [userInput, setUserInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedEndpoint[]>([])
  const [error, setError] = useState('')

  const currentType = INPUT_TYPES.find(t => t.value === inputType)!

  const handleGenerate = async () => {
    if (!userInput.trim()) return
    setError('')
    setGenerating(true)
    setGenerated([])
    try {
      const raw = await AIEngine.GenerateMockEndpoints(inputType, userInput)
      const parsed: GeneratedEndpoint[] = JSON.parse(raw)
      setGenerated(parsed)
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  const handleImport = () => {
    onImport(generated.map(toImportable))
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-border-1 rounded-lg shadow-2xl w-[640px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1 flex-shrink-0">
          <Sparkles size={16} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">Generate Mock Endpoints with AI</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-text-3 hover:text-text-1">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
          {/* Input type */}
          <div className="flex gap-2">
            {INPUT_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => setInputType(t.value as typeof inputType)}
                className={`px-3 py-1.5 rounded text-xs transition-colors border ${
                  inputType === t.value
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 text-text-2 border-border-1 hover:text-text-1'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Input area */}
          <textarea
            className="w-full h-36 px-3 py-2.5 bg-surface-2 border border-border-1 rounded text-xs text-text-1 placeholder-text-3 font-mono outline-none focus:border-accent resize-none"
            placeholder={currentType.placeholder}
            value={userInput}
            onChange={e => setUserInput(e.target.value)}
            spellCheck={false}
          />

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!userInput.trim() || generating}
            className="self-start flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
          >
            {generating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>

          {/* Preview */}
          {generated.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-text-3 uppercase tracking-wider">{generated.length} endpoint{generated.length !== 1 ? 's' : ''} generated</p>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {generated.map((ep, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 bg-surface-2 border border-border-1 rounded text-xs">
                    <span className={`font-mono font-semibold w-14 flex-shrink-0 ${
                      ep.method === 'GET' ? 'text-method-get' :
                      ep.method === 'POST' ? 'text-method-post' :
                      ep.method === 'PUT' ? 'text-method-put' :
                      ep.method === 'PATCH' ? 'text-method-patch' :
                      ep.method === 'DELETE' ? 'text-method-delete' : 'text-text-2'
                    }`}>{ep.method}</span>
                    <span className="text-text-1 flex-1 font-mono truncate">{ep.path}</span>
                    <span className="text-text-3">{ep.statusCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-1 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={generated.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white rounded text-xs hover:bg-accent-light disabled:opacity-40 transition-colors"
          >
            <Download size={12} />
            Import {generated.length > 0 ? generated.length : ''} endpoint{generated.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
