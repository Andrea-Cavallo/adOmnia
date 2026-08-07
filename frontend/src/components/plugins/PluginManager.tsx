import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Power, AlertTriangle, ChevronDown, ChevronRight, Trash2, Cpu, LayoutPanelLeft, ArrowLeft, Upload, FileJson, Code2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePluginsStore, type PluginInstance } from '@/stores/plugins'
import {
  getPlugins,
  enablePlugin,
  disablePlugin,
  installPlugin,
  installPluginDirectory,
  installPluginPackage,
  selectPluginDirectory,
  uninstallPlugin,
} from '@/lib/plugins-api'
import { PluginSettings } from './PluginSettings'
import { PluginDevTools } from './PluginDevTools'
import { PluginPanel } from './PluginPanel'

// ─── Install modal (3 modes) ──────────────────────────────────────────────────

type InstallTab = 'file' | 'form' | 'json'

const PERMISSIONS = ['http', 'storage', 'notifications', 'env']
const RUNTIMES    = ['js', 'none']

interface PluginFormState {
  id: string
  name: string
  version: string
  author: string
  description: string
  entryPoint: string
  runtime: string
  license: string
  homepage: string
  permissions: string[]
}

function slugify(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function formToJson(f: PluginFormState): string {
  const manifest = {
    id: f.id || slugify(f.name),
    name: f.name,
    version: f.version || '1.0.0',
    author: f.author,
    description: f.description,
    homepage: f.homepage,
    license: f.license || 'MIT',
    minAppVersion: '1.0.0',
    runtime: f.runtime,
    permissions: f.permissions,
    hooks: [],
    settings: [],
    entryPoint: f.runtime === 'none' ? '' : f.entryPoint,
    icon: '',
  }
  return JSON.stringify(manifest, null, 2)
}

function InstallModal({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const [tab, setTab] = useState<InstallTab>('file')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [form, setForm] = useState<PluginFormState>({
    id: '', name: '', version: '1.0.0', author: '', description: '',
    entryPoint: 'main.js', runtime: 'js', license: 'MIT', homepage: '', permissions: [],
  })

  // Raw JSON state
  const [rawJson, setRawJson] = useState('')

  const setF = (key: keyof PluginFormState, value: string | string[]) =>
    setForm(p => ({ ...p, [key]: value }))

  const doInstall = useCallback(async (json: string) => {
    setBusy(true)
    setError('')
    try {
      await installPlugin(json.trim())
      await onInstalled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installazione plugin fallita.')
    } finally {
      setBusy(false)
    }
  }, [onInstalled, onClose])

  const installFolder = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList)
    const manifestFile = files
      .filter((file) => file.name.toLowerCase() === 'manifest.json')
      .sort((a, b) => a.webkitRelativePath.length - b.webkitRelativePath.length)[0]
    if (!manifestFile) {
      setError('La cartella selezionata non contiene manifest.json.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const manifestPath = manifestFile.webkitRelativePath || manifestFile.name
      const prefix = manifestPath.slice(0, manifestPath.length - manifestFile.name.length)
      const encodedFiles: Record<string, string> = {}
      for (const file of files) {
        const path = file.webkitRelativePath || file.name
        if (prefix && !path.startsWith(prefix)) continue
        const relativePath = prefix ? path.slice(prefix.length) : path
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        encodedFiles[relativePath] = btoa(binary)
      }
      await installPluginPackage(await manifestFile.text(), encodedFiles)
      await onInstalled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installazione cartella plugin fallita.')
    } finally {
      setBusy(false)
    }
  }, [onInstalled, onClose])

  const chooseAndInstallFolder = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const sourceDir = await selectPluginDirectory()
      if (!sourceDir) return
      await installPluginDirectory(sourceDir)
      await onInstalled()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installazione cartella plugin fallita.')
    } finally {
      setBusy(false)
    }
  }, [onInstalled, onClose])

  // File drop / file pick
  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Seleziona un file manifest.json')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      try {
        JSON.parse(text) // validate
        doInstall(text)
      } catch {
        setError('Il file non contiene JSON valido.')
      }
    }
    reader.readAsText(file)
  }, [doInstall])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 1) {
      void installFolder(e.dataTransfer.files)
      return
    }
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile, installFolder])

  const handleFormInstall = () => {
    if (!form.name.trim() || !form.author.trim()) {
      setError('Nome e autore sono obbligatori.')
      return
    }
    doInstall(formToJson(form))
  }

  const TABS: { id: InstallTab; icon: React.ElementType; label: string }[] = [
    { id: 'file', icon: Upload,   label: 'Da file'  },
    { id: 'form', icon: FileJson, label: 'Form'     },
    { id: 'json', icon: Code2,    label: 'JSON raw' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[520px] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <h2 className="text-sm font-semibold text-text-1">Installa plugin</h2>
          <button onClick={onClose} className="text-text-3 hover:text-text-1 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pb-0 flex-shrink-0">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError('') }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors',
                tab === id
                  ? 'border-accent text-accent bg-accent/5'
                  : 'border-transparent text-text-3 hover:text-text-2 hover:bg-surface-2'
              )}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        <div className="border-t border-border-1 mx-0" />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* ── Tab: file ─────────────────────────────────────── */}
          {tab === 'file' && (
            <div className="space-y-3">
              <p className="text-xs text-text-3">Per un plugin JavaScript eseguibile installa la cartella completa, incluso l'entrypoint dichiarato.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseAndInstallFolder()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Upload size={13} />
                Installa cartella plugin (consigliato)
              </button>
              <p className="pt-2 text-[10px] uppercase tracking-wider text-text-4">Solo manifest</p>
              <p className="text-xs text-text-3">
                Usa questa opzione solo per registrare un plugin senza file eseguibili.
              </p>
              <div
                className={cn(
                  'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-5 cursor-pointer transition-colors',
                  dragging ? 'border-accent bg-accent/5' : 'border-border-2 hover:border-accent/50 hover:bg-surface-1'
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <Upload size={28} className={cn('transition-colors', dragging ? 'text-accent' : 'text-text-4')} />
                <span className="text-xs text-text-3">
                  {dragging ? 'Rilascia qui' : 'Seleziona manifest.json'}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </div>
          )}

          {/* ── Tab: form ─────────────────────────────────────── */}
          {tab === 'form' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome *" value={form.name} onChange={v => { setF('name', v); setF('id', slugify(v)) }} placeholder="My Plugin" />
                <Field label="ID" value={form.id} onChange={v => setF('id', v)} placeholder="auto" mono />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Autore *" value={form.author} onChange={v => setF('author', v)} placeholder="Nome Cognome" />
                <Field label="Versione" value={form.version} onChange={v => setF('version', v)} placeholder="1.0.0" mono />
              </div>
              <Field label="Descrizione" value={form.description} onChange={v => setF('description', v)} placeholder="Cosa fa il plugin..." />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-text-3 mb-1 uppercase tracking-wider">Runtime</label>
                  <select
                    value={form.runtime}
                    onChange={(e) => setF('runtime', e.target.value)}
                    className="w-full h-7 px-2 rounded bg-surface-1 border border-border-1 text-xs text-text-1 focus:outline-none focus:border-accent"
                  >
                    {RUNTIMES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <Field label="Entry point" value={form.entryPoint} onChange={v => setF('entryPoint', v)} placeholder="main.js" mono />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Licenza" value={form.license} onChange={v => setF('license', v)} placeholder="MIT" />
                <Field label="Homepage" value={form.homepage} onChange={v => setF('homepage', v)} placeholder="https://..." />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-text-3 mb-1.5 uppercase tracking-wider">Permessi</label>
                <div className="flex flex-wrap gap-1.5">
                  {PERMISSIONS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setF('permissions', form.permissions.includes(p)
                        ? form.permissions.filter(x => x !== p)
                        : [...form.permissions, p]
                      )}
                      className={cn(
                        'px-2 py-0.5 text-[10px] font-mono rounded border transition-colors',
                        form.permissions.includes(p)
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border-2 text-text-3 hover:border-accent/40'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              {/* JSON preview */}
              <details className="group">
                <summary className="cursor-pointer text-[10px] text-text-4 hover:text-text-3 select-none">
                  Anteprima JSON generato
                </summary>
                <pre className="mt-2 p-2 rounded bg-surface-1 border border-border-1 text-[10px] font-mono text-text-3 overflow-auto max-h-40">
                  {formToJson(form)}
                </pre>
              </details>
            </div>
          )}

          {/* ── Tab: json raw ─────────────────────────────────── */}
          {tab === 'json' && (
            <div className="space-y-2">
              <p className="text-xs text-text-3">
                Incolla il manifest JSON completo. Per sviluppatori avanzati.
              </p>
              <textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                className="w-full h-56 px-3 py-2 text-xs font-mono bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent resize-none"
                placeholder='{"id": "my-plugin", "name": "My Plugin", ...}'
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-1 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors"
          >
            Annulla
          </button>
          {tab === 'form' && (
            <button
              onClick={handleFormInstall}
              disabled={busy || !form.name.trim()}
              className={cn(
                'px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
                !busy && form.name.trim()
                  ? 'bg-accent text-white hover:opacity-90'
                  : 'bg-surface-2 text-text-4 cursor-not-allowed'
              )}
            >
              {busy ? 'Installazione…' : 'Installa'}
            </button>
          )}
          {tab === 'json' && (
            <button
              onClick={() => doInstall(rawJson)}
              disabled={busy || !rawJson.trim()}
              className={cn(
                'px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
                !busy && rawJson.trim()
                  ? 'bg-accent text-white hover:opacity-90'
                  : 'bg-surface-2 text-text-4 cursor-not-allowed'
              )}
            >
              {busy ? 'Installazione…' : 'Installa'}
            </button>
          )}
          {tab === 'file' && (
            <span className="px-4 py-1.5 text-xs text-text-4 italic">
              Seleziona o trascina un file
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-text-3 mb-1 uppercase tracking-wider">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full h-7 px-2 rounded bg-surface-1 border border-border-1 text-xs text-text-1 focus:outline-none focus:border-accent placeholder:text-text-4',
          mono && 'font-mono'
        )}
      />
    </div>
  )
}

export function PluginManager() {
  const { plugins, setPlugins, setLoading, loading } = usePluginsStore()
  const [view, setView] = useState<'plugins' | 'runtime'>('plugins')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [installMode, setInstallMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [activePanelPlugin, setActivePanelPlugin] = useState<PluginInstance | null>(null)
  const [loadError, setLoadError] = useState('')

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const all = await getPlugins()
      setPlugins(all)
    } catch (err) {
      setPlugins([])
      setLoadError(err instanceof Error ? err.message : 'Impossibile caricare i plugin installati.')
    } finally {
      setLoading(false)
    }
  }, [setPlugins, setLoading])

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  const handleToggle = async (plugin: PluginInstance) => {
    if (plugin.enabled) {
      await disablePlugin(plugin.manifest.id)
    } else {
      await enablePlugin(plugin.manifest.id)
    }
    await loadPlugins()
  }

  const handleUninstall = async (id: string) => {
    await uninstallPlugin(id)
    await loadPlugins()
    setConfirmDelete(null)
    setExpandedId(null)
  }

  // If a plugin panel is active, render it instead of the plugin list
  if (activePanelPlugin) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
        <div className="h-8 flex items-center gap-2 px-3 border-b border-border-1 bg-surface-1 flex-shrink-0">
          <button
            onClick={() => setActivePanelPlugin(null)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-3 hover:text-text-1 transition-colors"
          >
            <ArrowLeft size={12} />
            Back to Plugins
          </button>
        </div>
        <PluginPanel plugin={activePanelPlugin} />
      </div>
    )
  }

  // Plugins that declare "panel" in ui_slots
  const panelPlugins = plugins.filter(
    (p) => p.enabled && p.manifest.ui_slots?.includes('panel')
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-1 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-1">Plugins</h1>
          <p className="text-xs text-text-3 mt-0.5">Extend adOmnia with custom functionality</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(view === 'plugins' ? 'runtime' : 'plugins')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Cpu size={13} />
            {view === 'plugins' ? 'Dettagli sviluppatore' : 'Plugin installati'}
          </button>
          <button
            onClick={() => setInstallMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
          >
            <Plus size={13} />
            Install Plugin
          </button>
        </div>
      </header>

      {view === 'runtime' ? (
        <PluginDevTools embedded />
      ) : (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5 rounded-md border border-border-1 bg-surface-1 px-4 py-3">
          <p className="text-xs font-medium text-text-1">Come usare i plugin</p>
          <p className="mt-1 text-xs text-text-3">
            Installa la cartella completa del plugin, abilitalo e apri il suo pannello per eseguire le azioni disponibili.
            Se avevi importato solo il manifest, la cartella completa ripara l'installazione. Dettagli sviluppatore serve solo per diagnosi.
          </p>
        </div>
        {loadError && (
          <div className="mb-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            {loadError}
          </div>
        )}
        {/* Panel plugin shortcuts */}
        {panelPlugins.length > 0 && (
          <div className="mb-5">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-2 px-1">
              Plugin Panels
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {panelPlugins.map((p) => (
                <button
                  key={p.manifest.id}
                  onClick={() => setActivePanelPlugin(p)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border-1 bg-surface-1 hover:bg-surface-2 hover:border-accent/30 transition-all text-left"
                >
                  <div className="w-7 h-7 rounded-md bg-surface-2 flex items-center justify-center flex-shrink-0">
                    <LayoutPanelLeft size={12} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-1 truncate">{p.manifest.name}</div>
                    <div className="text-[10px] text-text-4 truncate">
                      {p.manifest.actions?.length ?? 0} action{(p.manifest.actions?.length ?? 0) !== 1 ? 's' : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && plugins.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-sm text-text-3">Loading plugins...</div>
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Power size={32} className="text-text-4" />
            <p className="text-sm text-text-3">No plugins installed yet.</p>
            <button
              onClick={() => setInstallMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
            >
              <Plus size={13} />
              Install Your First Plugin
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {plugins.map((plugin) => {
              const isExpanded = expandedId === plugin.manifest.id
              const hasError = Boolean(plugin.error)

              return (
                <div
                  key={plugin.manifest.id}
                  className={cn(
                    'rounded-lg border transition-all',
                    hasError
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-border-1 bg-surface-1'
                  )}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : plugin.manifest.id)}
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center">
                        <span className="text-xs font-bold text-accent">
                          {plugin.manifest.name.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface-1',
                          hasError ? 'bg-red-500' : plugin.enabled ? 'bg-green-500' : 'bg-text-4'
                        )}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-text-1 truncate">{plugin.manifest.name}</h4>
                        <span className="text-[10px] text-text-4">v{plugin.manifest.version}</span>
                      </div>
                      <p className="text-xs text-text-3 truncate">
                        {plugin.manifest.description || `by ${plugin.manifest.author}`}
                      </p>
                    </div>

                    {hasError && (
                      <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-red-400 bg-red-500/10 rounded">
                        <AlertTriangle size={10} />
                        Error
                      </div>
                    )}

                    <button
                      aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.manifest.name}`}
                      aria-pressed={plugin.enabled}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggle(plugin)
                      }}
                      className={cn(
                        'relative w-8 h-4 rounded-full transition-colors flex-shrink-0',
                        plugin.enabled ? 'bg-accent' : 'bg-surface-3'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                          plugin.enabled ? 'left-[18px]' : 'left-0.5'
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${plugin.manifest.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setExpandedId(isExpanded ? null : plugin.manifest.id)
                      }}
                      className="rounded p-0.5 text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border-1 px-4 py-4 space-y-4">
                      {hasError && (
                        <div className="px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20">
                          <p className="text-xs text-red-400 font-mono">{plugin.error}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <span className="text-text-4 block mb-0.5">Author</span>
                          <span className="text-text-2">{plugin.manifest.author}</span>
                        </div>
                        <div>
                          <span className="text-text-4 block mb-0.5">License</span>
                          <span className="text-text-2">{plugin.manifest.license || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-text-4 block mb-0.5">Installed</span>
                          <span className="text-text-2">
                            {new Date(plugin.installedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      {plugin.manifest.permissions.length > 0 && (
                        <div>
                          <h5 className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1.5">
                            Permissions
                          </h5>
                          <div className="flex flex-wrap gap-1">
                            {plugin.manifest.permissions.map((perm) => (
                              <span
                                key={perm}
                                className="px-1.5 py-0.5 text-[10px] font-medium bg-surface-2 text-text-3 rounded"
                              >
                                {perm}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {plugin.manifest.hooks.length > 0 && (
                        <div>
                          <h5 className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1.5">
                            Registered Hooks
                          </h5>
                          <div className="space-y-1">
                            {plugin.manifest.hooks.map((hook, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="px-1.5 py-0.5 font-mono text-[10px] bg-surface-2 text-accent rounded">
                                  {hook.event}
                                </span>
                                <span className="text-text-4">&rarr;</span>
                                <span className="text-text-3 font-mono text-[10px]">{hook.handler}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {plugin.manifest.settings.length > 0 && (
                        <PluginSettings plugin={plugin} onSaved={loadPlugins} />
                      )}

                      <div className="flex items-center justify-between pt-2 border-t border-border-1">
                        {plugin.manifest.ui_slots?.includes('panel') && (
                          <button
                            onClick={() => setActivePanelPlugin(plugin)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
                          >
                            <LayoutPanelLeft size={11} />
                            Open Panel
                          </button>
                        )}
                        <div className="flex-1" />
                        {confirmDelete === plugin.manifest.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-3">Confirm removal?</span>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 text-xs text-text-3 hover:text-text-1 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUninstall(plugin.manifest.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 rounded transition-colors"
                            >
                              <Trash2 size={11} />
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(plugin.manifest.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-text-3 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={11} />
                            Uninstall
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {installMode && (
        <InstallModal
          onClose={() => setInstallMode(false)}
          onInstalled={loadPlugins}
        />
      )}
    </div>
  )
}
