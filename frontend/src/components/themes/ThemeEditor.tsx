import { useState, useCallback } from 'react'
import { X, Save, ShieldCheck, AlertTriangle, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Theme } from '@/stores/themes'
import {
  validateTheme,
  checkContrast,
  type ThemeValidationResult,
  type ContrastResult,
} from '@/lib/themes-api'

interface ThemeEditorProps {
  theme: Theme | null
  onSave: (theme: Theme) => void
  onClose: () => void
}

const DEFAULT_COLOR_KEYS = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'text-1',
  'text-2',
  'text-3',
  'text-4',
  'accent',
  'border-1',
  'border-2',
  'success',
  'warning',
  'error',
]

type EditorTab = 'colors' | 'fonts' | 'validation' | 'contrast'

function generateId(): string {
  return `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createBlankTheme(): Theme {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: '',
    author: '',
    version: '1.0.0',
    description: '',
    colors: Object.fromEntries(DEFAULT_COLOR_KEYS.map((k) => [k, '#1a1a2e'])),
    fonts: { sans: 'Inter, system-ui, sans-serif', mono: 'JetBrains Mono, monospace', serif: 'Georgia, serif' },
    spacing: {},
    radii: {},
    shadows: {},
    meta: {},
    createdAt: now,
    updatedAt: now,
  }
}

export function ThemeEditor({ theme, onSave, onClose }: ThemeEditorProps) {
  const [draft, setDraft] = useState<Theme>(() => theme ? { ...theme } : createBlankTheme())
  const [tab, setTab] = useState<EditorTab>('colors')
  const [validation, setValidation] = useState<ThemeValidationResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [contrastResults, setContrastResults] = useState<ContrastResult[]>([])
  const [contrastLoading, setContrastLoading] = useState(false)

  const updateField = useCallback(<K extends keyof Theme>(key: K, value: Theme[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value, updatedAt: new Date().toISOString() }))
  }, [])

  const updateColor = useCallback((key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, [key]: value },
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateFont = useCallback((key: 'sans' | 'mono' | 'serif', value: string) => {
    setDraft((prev) => ({
      ...prev,
      fonts: { ...prev.fonts, [key]: value },
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const handleValidate = async () => {
    setValidating(true)
    const result = await validateTheme(draft)
    setValidation(result)
    setValidating(false)
    setTab('validation')
  }

  const handleCheckContrast = async () => {
    setContrastLoading(true)
    const results = await checkContrast(draft)
    setContrastResults(results)
    setContrastLoading(false)
    setTab('contrast')
  }

  const handleSave = () => {
    if (!draft.name.trim()) return
    onSave(draft)
  }

  const colorKeys = Object.keys(draft.colors).length > 0
    ? Object.keys(draft.colors)
    : DEFAULT_COLOR_KEYS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[960px] max-h-[85vh] flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border-1">
          <h2 className="text-lg font-semibold text-text-1">
            {theme ? 'Edit Theme' : 'Create Theme'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={validating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
            >
              <ShieldCheck size={13} />
              {validating ? 'Checking...' : 'Validate'}
            </button>
            <button
              onClick={handleCheckContrast}
              disabled={contrastLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
            >
              <Eye size={13} />
              {contrastLoading ? 'Checking...' : 'Contrast'}
            </button>
            <button onClick={onClose} className="text-text-3 hover:text-text-1 transition-colors ml-2">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto flex">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-6 pt-3 border-b border-border-1">
              {([
                { key: 'colors', label: 'Colors' },
                { key: 'fonts', label: 'Fonts' },
                { key: 'validation', label: 'Validation' },
                { key: 'contrast', label: 'Contrast' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
                    tab === key
                      ? 'text-accent border-accent'
                      : 'text-text-3 border-transparent hover:text-text-2'
                  )}
                >
                  {label}
                  {key === 'validation' && validation && (
                    <span className={cn(
                      'ml-1.5 px-1 py-0.5 text-[9px] font-bold rounded',
                      validation.valid ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                    )}>
                      {validation.valid ? 'OK' : validation.errors.length}
                    </span>
                  )}
                  {key === 'contrast' && contrastResults.length > 0 && (
                    <span className="ml-1.5 px-1 py-0.5 text-[9px] font-bold bg-blue-500/15 text-blue-400 rounded">
                      {contrastResults.filter((r) => r.aaNormal).length}/{contrastResults.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <section className="space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-text-3">Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-text-3">Name</span>
                    <input
                      value={draft.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent"
                      placeholder="My Theme"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-text-3">Author</span>
                    <input
                      value={draft.author}
                      onChange={(e) => updateField('author', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent"
                      placeholder="Your name"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-text-3">Version</span>
                    <input
                      value={draft.version}
                      onChange={(e) => updateField('version', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent"
                      placeholder="1.0.0"
                    />
                  </label>
                  <label className="space-y-1 col-span-2">
                    <span className="text-xs text-text-3">Description</span>
                    <textarea
                      value={draft.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent resize-none h-16"
                      placeholder="A brief description of this theme..."
                    />
                  </label>
                </div>
              </section>

              {tab === 'colors' && (
                <section className="space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-text-3">Colors</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {colorKeys.map((key) => (
                      <div key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-1">
                        <input
                          type="color"
                          value={draft.colors[key] || '#000000'}
                          onChange={(e) => updateColor(key, e.target.value)}
                          className="w-6 h-6 rounded border border-border-2 flex-shrink-0 cursor-pointer bg-transparent"
                        />
                        <span className="text-xs text-text-2 flex-1 truncate">{key}</span>
                        <input
                          type="text"
                          value={draft.colors[key] || ''}
                          onChange={(e) => updateColor(key, e.target.value)}
                          className="w-20 px-1.5 py-0.5 text-xs bg-surface-2 border border-border-1 rounded text-text-1 font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {tab === 'fonts' && (
                <section className="space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-text-3">Fonts</h3>
                  <div className="space-y-2">
                    {(['sans', 'mono', 'serif'] as const).map((fontKey) => (
                      <label key={fontKey} className="flex items-center gap-3">
                        <span className="text-xs text-text-3 w-12 capitalize">{fontKey}</span>
                        <input
                          value={draft.fonts[fontKey]}
                          onChange={(e) => updateFont(fontKey, e.target.value)}
                          className="flex-1 px-3 py-1.5 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 space-y-1 p-3 rounded-md bg-surface-1 border border-border-1">
                    <p style={{ fontFamily: draft.fonts.sans }} className="text-sm text-text-1">
                      Sans: The quick brown fox jumps over the lazy dog
                    </p>
                    <p style={{ fontFamily: draft.fonts.mono }} className="text-sm text-text-1">
                      Mono: const x = 42; fn(a, b) {'{'}...{'}'}
                    </p>
                    <p style={{ fontFamily: draft.fonts.serif }} className="text-sm text-text-1">
                      Serif: Elegant typeface specimen
                    </p>
                  </div>
                </section>
              )}

              {tab === 'validation' && (
                <ValidationPanel result={validation} loading={validating} onValidate={handleValidate} />
              )}

              {tab === 'contrast' && (
                <ContrastPanel results={contrastResults} loading={contrastLoading} onCheck={handleCheckContrast} />
              )}
            </div>
          </div>

          <div className="w-72 p-6 space-y-4 border-l border-border-1">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-3">Preview</h3>
            <div
              className="rounded-lg border overflow-hidden"
              style={{
                borderColor: draft.colors['border-1'] || '#333',
                backgroundColor: draft.colors['surface-0'] || '#0a0a0f',
              }}
            >
              <div
                className="px-3 py-2 border-b"
                style={{
                  borderColor: draft.colors['border-1'] || '#333',
                  backgroundColor: draft.colors['surface-1'] || '#111',
                }}
              >
                <div
                  className="text-xs font-medium"
                  style={{ color: draft.colors['text-1'] || '#fff' }}
                >
                  Header
                </div>
              </div>
              <div className="p-3 space-y-2" style={{ backgroundColor: draft.colors['surface-0'] || '#0a0a0f' }}>
                <div className="text-sm" style={{ color: draft.colors['text-1'] || '#fff' }}>
                  Primary text
                </div>
                <div className="text-xs" style={{ color: draft.colors['text-3'] || '#666' }}>
                  Secondary description text
                </div>
                <div
                  className="mt-2 px-3 py-1.5 rounded text-xs font-medium text-center"
                  style={{
                    backgroundColor: draft.colors['accent'] || '#6366f1',
                    color: '#fff',
                  }}
                >
                  Accent Button
                </div>
                <div className="flex gap-1 mt-2">
                  {['surface-1', 'surface-2', 'surface-3'].map((s) => (
                    <div
                      key={s}
                      className="flex-1 h-6 rounded"
                      style={{ backgroundColor: draft.colors[s] || '#222' }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <p
                className="text-xs"
                style={{ fontFamily: draft.fonts.sans, color: draft.colors['text-2'] || '#aaa' }}
              >
                Sans: The quick brown fox
              </p>
              <p
                className="text-xs"
                style={{ fontFamily: draft.fonts.mono, color: draft.colors['text-2'] || '#aaa' }}
              >
                Mono: const x = 42;
              </p>
              <p
                className="text-xs"
                style={{ fontFamily: draft.fonts.serif, color: draft.colors['text-2'] || '#aaa' }}
              >
                Serif: Elegant typeface
              </p>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-1">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-2 hover:text-text-1 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.name.trim()}
            className={cn(
              'flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              draft.name.trim()
                ? 'bg-accent text-white hover:opacity-90'
                : 'bg-surface-2 text-text-4 cursor-not-allowed'
            )}
          >
            <Save size={14} />
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}

interface ValidationPanelProps {
  result: ThemeValidationResult | null
  loading: boolean
  onValidate: () => void
}

function ValidationPanel({ result, loading, onValidate }: ValidationPanelProps) {
  if (!result && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <ShieldCheck size={28} className="text-text-4" />
        <p className="text-sm text-text-3">Click "Validate" to check this theme against the required token spec.</p>
        <button
          onClick={onValidate}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-colors"
        >
          Run Validation
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-sm text-text-3">Validating...</span>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className={cn(
        'flex items-center gap-2 px-4 py-3 rounded-lg border',
        result!.valid
          ? 'bg-green-500/5 border-green-500/20 text-green-400'
          : 'bg-red-500/5 border-red-500/20 text-red-400'
      )}>
        {result!.valid ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
        <span className="text-sm font-medium">
          {result!.valid ? 'Theme is valid' : `${result!.errors.length} error(s) found`}
        </span>
      </div>

      {result!.errors.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-red-400 uppercase tracking-wider">Errors</h4>
          {result!.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded bg-red-500/5 border border-red-500/10 text-xs text-red-300">
              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
              {err}
            </div>
          ))}
        </div>
      )}

      {result!.warnings.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-yellow-400 uppercase tracking-wider">Warnings</h4>
          {result!.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded bg-yellow-500/5 border border-yellow-500/10 text-xs text-yellow-300">
              <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

interface ContrastPanelProps {
  results: ContrastResult[]
  loading: boolean
  onCheck: () => void
}

function ContrastPanel({ results, loading, onCheck }: ContrastPanelProps) {
  if (results.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <Eye size={28} className="text-text-4" />
        <p className="text-sm text-text-3">Click "Contrast" to run WCAG contrast checks.</p>
        <button
          onClick={onCheck}
          className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md hover:opacity-90 transition-colors"
        >
          Check Contrast
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-sm text-text-3">Checking contrast ratios...</span>
      </div>
    )
  }

  const passCount = results.filter((r) => r.aaNormal).length

  return (
    <section className="space-y-4">
      <div className={cn(
        'flex items-center gap-2 px-4 py-3 rounded-lg border',
        passCount === results.length
          ? 'bg-green-500/5 border-green-500/20 text-green-400'
          : passCount >= results.length * 0.7
            ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-400'
            : 'bg-red-500/5 border-red-500/20 text-red-400'
      )}>
        <Eye size={16} />
        <span className="text-sm font-medium">
          {passCount}/{results.length} pairs pass AA Normal
        </span>
      </div>

      <div className="rounded-lg border border-border-1 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-1 text-text-3">
              <th className="text-left px-3 py-2 font-medium">Pair</th>
              <th className="text-center px-3 py-2 font-medium">Ratio</th>
              <th className="text-center px-3 py-2 font-medium">AA Normal</th>
              <th className="text-center px-3 py-2 font-medium">AA Large</th>
              <th className="text-center px-3 py-2 font-medium">AAA</th>
              <th className="text-center px-3 py-2 font-medium">Level</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border-1 hover:bg-surface-1/50 transition-colors">
                <td className="px-3 py-1.5 font-mono text-text-2">{r.pair}</td>
                <td className="px-3 py-1.5 text-center font-mono text-text-1">{r.ratio.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-center">
                  {r.aaNormal
                    ? <span className="text-green-400">Pass</span>
                    : <span className="text-red-400">Fail</span>
                  }
                </td>
                <td className="px-3 py-1.5 text-center">
                  {r.aaLarge
                    ? <span className="text-green-400">Pass</span>
                    : <span className="text-red-400">Fail</span>
                  }
                </td>
                <td className="px-3 py-1.5 text-center">
                  {r.aaaNormal
                    ? <span className="text-green-400">Pass</span>
                    : <span className="text-yellow-400">—</span>
                  }
                </td>
                <td className="px-3 py-1.5 text-center">
                  <span className={cn(
                    'px-1.5 py-0.5 text-[10px] font-medium rounded',
                    r.level === 'AAA' && 'bg-green-500/15 text-green-400',
                    r.level === 'AA' && 'bg-blue-500/15 text-blue-400',
                    r.level === 'AA Large' && 'bg-yellow-500/15 text-yellow-400',
                    r.level === 'Fail' && 'bg-red-500/15 text-red-400',
                  )}>
                    {r.level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
