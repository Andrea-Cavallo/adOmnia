import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download, Upload, Plus, MoreHorizontal, Copy, Trash2, Check,
  FolderOpen, Globe, RefreshCw, AlertTriangle, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useThemesStore, type Theme } from '@/stores/themes'
import { useThemeContext } from './ThemeProvider'
import { ThemeEditor } from './ThemeEditor'
import { loadAvailableThemes } from '@/lib/themeCatalog'
import {
  getBuiltinThemes,
  getExtendedBuiltinThemes,
  saveTheme,
  deleteTheme,
  exportTheme,
  importTheme,
  scanSkinsDirectory,
  getSkinsDirectory,
  importSkinFromURL,
  startWatching,
  stopWatching,
  getChangedSkins,
  getTokenNamespace,
  type TokenDefinition,
} from '@/lib/themes-api'

type PanelTab = 'installed' | 'skins' | 'tokens'

export function ThemePanel() {
  const { themes, activeThemeId, setThemes, setLoading, loading } = useThemesStore()
  const { applyTheme } = useThemeContext()

  const [tab, setTab] = useState<PanelTab>('installed')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [importMode, setImportMode] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [importUrlMode, setImportUrlMode] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importUrlLoading, setImportUrlLoading] = useState(false)
  const [builtinIds, setBuiltinIds] = useState<Set<string>>(new Set())
  const [builtinThemes, setBuiltinThemes] = useState<Theme[]>([])

  const [dirSkins, setDirSkins] = useState<Theme[]>([])
  const [skinsDir, setSkinsDir] = useState('')
  const [dirLoading, setDirLoading] = useState(false)
  const [changedSkins, setChangedSkins] = useState<string[]>([])
  const [watching, setWatching] = useState(false)
  const watchInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const [tokens, setTokens] = useState<Record<string, TokenDefinition[]>>({})
  const [tokensLoading, setTokensLoading] = useState(false)

  const loadThemes = useCallback(async () => {
    setLoading(true)
    const [all, builtins, extended] = await Promise.all([
      loadAvailableThemes(),
      getBuiltinThemes(),
      getExtendedBuiltinThemes(),
    ])
    const builtinSet = new Set([
      ...builtins.map((b) => b.id),
      ...extended.map((b) => b.id),
    ])
    setThemes(all)
    setBuiltinIds(builtinSet)
    setBuiltinThemes([...builtins, ...extended])
    setLoading(false)
  }, [setThemes, setLoading])

  useEffect(() => {
    loadThemes()
  }, [loadThemes])

  useEffect(() => {
    return () => {
      if (watchInterval.current) clearInterval(watchInterval.current)
      stopWatching()
    }
  }, [])

  const handleActivate = (theme: Theme) => {
    applyTheme(theme)
  }

  const handleSaveTheme = async (theme: Theme) => {
    const success = await saveTheme(theme)
    if (success) {
      await loadThemes()
      setEditorOpen(false)
      setEditingTheme(null)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteTheme(id)
    await loadThemes()
    setMenuOpenId(null)
  }

  const handleExport = async (id: string) => {
    const json = await exportTheme(id)
    if (json) navigator.clipboard.writeText(json)
    setMenuOpenId(null)
  }

  const handleDuplicate = (theme: Theme) => {
    const dup: Theme = {
      ...theme,
      id: `theme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${theme.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setEditingTheme(dup)
    setEditorOpen(true)
    setMenuOpenId(null)
  }

  const handleImport = async () => {
    if (!importJson.trim()) return
    const result = await importTheme(importJson.trim())
    if (result) {
      await loadThemes()
      setImportMode(false)
      setImportJson('')
    }
  }

  const handleImportFromUrl = async () => {
    if (!importUrl.trim()) return
    setImportUrlLoading(true)
    const result = await importSkinFromURL(importUrl.trim())
    setImportUrlLoading(false)
    if (result) {
      await loadThemes()
      setImportUrlMode(false)
      setImportUrl('')
    }
  }

  const handleCreate = () => {
    setEditingTheme(null)
    setEditorOpen(true)
  }

  const loadSkinsDirectory = async () => {
    setDirLoading(true)
    const [skins, dir] = await Promise.all([scanSkinsDirectory(), getSkinsDirectory()])
    setDirSkins(skins)
    setSkinsDir(dir)
    setDirLoading(false)
  }

  const toggleWatching = async () => {
    if (watching) {
      await stopWatching()
      if (watchInterval.current) {
        clearInterval(watchInterval.current)
        watchInterval.current = null
      }
      setWatching(false)
      setChangedSkins([])
    } else {
      await startWatching()
      setWatching(true)
      watchInterval.current = setInterval(async () => {
        const changed = await getChangedSkins()
        if (changed.length > 0) {
          setChangedSkins(changed)
          await loadSkinsDirectory()
        }
      }, 3000)
    }
  }

  const loadTokens = async () => {
    setTokensLoading(true)
    const ns = await getTokenNamespace()
    setTokens(ns)
    setTokensLoading(false)
  }

  useEffect(() => {
    if (tab === 'skins' && dirSkins.length === 0) loadSkinsDirectory()
    if (tab === 'tokens' && Object.keys(tokens).length === 0) loadTokens()
  }, [tab])

  const installSkin = async (skin: Theme) => {
    const success = await saveTheme(skin)
    if (success) await loadThemes()
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-1 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-1">Themes</h1>
          <p className="text-xs text-text-3 mt-0.5">Customize the look and feel of adOmnia</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportUrlMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Globe size={13} />
            From URL
          </button>
          <button
            onClick={() => setImportMode(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Upload size={13} />
            Import
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
          >
            <Plus size={13} />
            Create Theme
          </button>
        </div>
      </header>

      <div className="flex items-center gap-1 px-6 pt-3 border-b border-border-1">
        {([
          { key: 'installed', label: 'Installed' },
          { key: 'skins', label: 'Skins Directory' },
          { key: 'tokens', label: 'Token Reference' },
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
          </button>
        ))}
        {watching && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-green-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Hot-reload active
            {changedSkins.length > 0 && (
              <span className="text-yellow-400">({changedSkins.length} changed)</span>
            )}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'installed' && (
          <InstalledTab
            themes={themes}
            builtinThemes={builtinThemes}
            activeThemeId={activeThemeId}
            loading={loading}
            builtinIds={builtinIds}
            menuOpenId={menuOpenId}
            setMenuOpenId={setMenuOpenId}
            onActivate={handleActivate}
            onDelete={handleDelete}
            onExport={handleExport}
            onDuplicate={handleDuplicate}
            onCreate={handleCreate}
            onEdit={(t) => { setEditingTheme(t); setEditorOpen(true) }}
          />
        )}
        {tab === 'skins' && (
          <SkinsTab
            skins={dirSkins}
            skinsDir={skinsDir}
            loading={dirLoading}
            watching={watching}
            installedIds={new Set(themes.map((t) => t.id))}
            onRefresh={loadSkinsDirectory}
            onToggleWatch={toggleWatching}
            onInstall={installSkin}
          />
        )}
        {tab === 'tokens' && (
          <TokensTab tokens={tokens} loading={tokensLoading} />
        )}
      </div>

      {importMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[500px] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-text-1">Import Theme</h2>
            <p className="text-xs text-text-3">Paste the exported theme JSON below:</p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              className="w-full h-48 px-3 py-2 text-xs font-mono bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent resize-none"
              placeholder='{"id": "...", "name": "...", ...}'
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setImportMode(false); setImportJson('') }}
                className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!importJson.trim()}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  importJson.trim()
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'bg-surface-2 text-text-4 cursor-not-allowed'
                )}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {importUrlMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[500px] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-text-1">Import Skin from URL</h2>
            <p className="text-xs text-text-3">Enter the URL to a skin.json file:</p>
            <input
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent"
                placeholder="https://your-domain.com/my-skin.json"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setImportUrlMode(false); setImportUrl('') }}
                className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportFromUrl}
                disabled={!importUrl.trim() || importUrlLoading}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  importUrl.trim() && !importUrlLoading
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'bg-surface-2 text-text-4 cursor-not-allowed'
                )}
              >
                {importUrlLoading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editorOpen && (
        <ThemeEditor
          theme={editingTheme}
          onSave={handleSaveTheme}
          onClose={() => { setEditorOpen(false); setEditingTheme(null) }}
        />
      )}
    </div>
  )
}

interface InstalledTabProps {
  themes: Theme[]
  builtinThemes: Theme[]
  activeThemeId: string
  loading: boolean
  builtinIds: Set<string>
  menuOpenId: string | null
  setMenuOpenId: (id: string | null) => void
  onActivate: (t: Theme) => void
  onDelete: (id: string) => void
  onExport: (id: string) => void
  onDuplicate: (t: Theme) => void
  onCreate: () => void
  onEdit: (t: Theme) => void
}

function InstalledTab({
  themes, builtinThemes, activeThemeId, loading, builtinIds, menuOpenId, setMenuOpenId,
  onActivate, onDelete, onExport, onDuplicate, onCreate, onEdit,
}: InstalledTabProps) {
  if (loading && themes.length === 0 && builtinThemes.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-sm text-text-3">Loading themes...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Built-in themes — always shown, allows reset to dark */}
      {builtinThemes.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-3 uppercase tracking-wider mb-3">Built-in</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {builtinThemes.map((theme) => {
              const isActive = theme.id === activeThemeId
              const colorPreview = Object.values(theme.colors).slice(0, 5)
              return (
                <div
                  key={theme.id}
                  onClick={() => onActivate(theme)}
                  className={cn(
                    'relative rounded-lg border p-3 transition-all cursor-pointer',
                    isActive
                      ? 'border-accent bg-surface-1 shadow-md shadow-accent/5'
                      : 'border-border-1 bg-surface-1 hover:border-border-2 hover:shadow-sm'
                  )}
                >
                  {isActive && (
                    <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-accent/15 text-accent rounded-full">
                      <Check size={10} /> Active
                    </span>
                  )}
                  <div className="flex gap-0.5 mb-2">
                    {colorPreview.map((color, i) => (
                      <div key={i} className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  <h3 className="text-xs font-medium text-text-1">{theme.name}</h3>
                  <p className="text-[10px] text-text-4 mt-0.5">{theme.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* User themes */}
      {themes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-3">
          <p className="text-sm text-text-3">No custom themes installed yet.</p>
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
          >
            <Plus size={13} />
            Create Your First Theme
          </button>
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium text-text-3 uppercase tracking-wider mb-3">Custom</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {themes.map((theme) => {
        const isActive = theme.id === activeThemeId
        const isBuiltin = builtinIds.has(theme.id)
        const colorPreview = Object.values(theme.colors).slice(0, 5)

        return (
          <div
            key={theme.id}
            className={cn(
              'group relative rounded-lg border p-4 transition-all cursor-pointer',
              isActive
                ? 'border-accent bg-surface-1 shadow-md shadow-accent/5'
                : 'border-border-1 bg-surface-1 hover:border-border-2 hover:shadow-sm'
            )}
            onClick={() => onActivate(theme)}
          >
            {isActive && (
              <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-accent/15 text-accent rounded-full">
                <Check size={10} />
                Active
              </span>
            )}

            <div className="flex items-start gap-3 mb-3">
              <div className="flex gap-0.5 mt-0.5">
                {colorPreview.map((color, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border border-white/10"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <h3 className="text-sm font-medium text-text-1 mb-0.5">{theme.name}</h3>
            <p className="text-xs text-text-3 mb-2">by {theme.author || 'Unknown'}</p>
            {theme.description && (
              <p className="text-xs text-text-4 line-clamp-2">{theme.description}</p>
            )}

            <div
              className={cn(
                'absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity',
                isActive && 'right-20'
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpenId(menuOpenId === theme.id ? null : theme.id)
                }}
                className="w-6 h-6 rounded flex items-center justify-center bg-surface-2 hover:bg-surface-3 text-text-2 hover:text-text-1 transition-colors"
              >
                <MoreHorizontal size={13} />
              </button>

              {menuOpenId === theme.id && (
                <div className="absolute top-7 left-0 z-20 w-36 bg-surface-2 border border-border-1 rounded-md shadow-lg py-1">
                  {!isBuiltin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(theme)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 transition-colors"
                    >
                      <BookOpen size={12} />
                      Edit
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onExport(theme.id)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 transition-colors"
                  >
                    <Download size={12} />
                    Export (Copy)
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDuplicate(theme)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-2 hover:text-text-1 hover:bg-surface-3 transition-colors"
                  >
                    <Copy size={12} />
                    Duplicate
                  </button>
                  {!isBuiltin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(theme.id)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-surface-3 transition-colors"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>

            <div
              className={cn(
                'absolute inset-0 rounded-lg flex items-center justify-center bg-surface-0/80 opacity-0 group-hover:opacity-100 transition-opacity',
                isActive && 'hidden'
              )}
            >
              <span className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-md shadow">
                Apply Theme
              </span>
            </div>
          </div>
        )
      })}
          </div>
        </div>
      )}
    </div>
  )
}

interface SkinsTabProps {
  skins: Theme[]
  skinsDir: string
  loading: boolean
  watching: boolean
  installedIds: Set<string>
  onRefresh: () => void
  onToggleWatch: () => void
  onInstall: (skin: Theme) => void
}

function SkinsTab({ skins, skinsDir, loading, watching, installedIds, onRefresh, onToggleWatch, onInstall }: SkinsTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-text-3" />
          <span className="text-xs text-text-3 font-mono truncate max-w-md">{skinsDir || 'Loading...'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleWatch}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
              watching
                ? 'text-green-400 border-green-400/30 bg-green-400/5 hover:bg-green-400/10'
                : 'text-text-2 border-border-1 bg-surface-1 hover:bg-surface-2'
            )}
          >
            <RefreshCw size={12} className={watching ? 'animate-spin' : ''} />
            {watching ? 'Watching' : 'Watch'}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Scan
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <span className="text-sm text-text-3">Scanning directory...</span>
        </div>
      ) : skins.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 gap-2">
          <AlertTriangle size={20} className="text-text-4" />
          <p className="text-sm text-text-3">No skin files found in directory.</p>
          <p className="text-xs text-text-4">Place .json skin files in the skins directory to see them here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {skins.map((skin) => {
            const isInstalled = installedIds.has(skin.id)
            const colorPreview = Object.values(skin.colors).slice(0, 5)

            return (
              <div
                key={skin.id}
                className="relative rounded-lg border border-border-1 bg-surface-1 p-4 transition-all hover:border-border-2 hover:shadow-sm"
              >
                <div className="flex gap-0.5 mb-3">
                  {colorPreview.map((color, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full border border-white/10"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <h3 className="text-sm font-medium text-text-1 mb-0.5">{skin.name}</h3>
                <p className="text-xs text-text-3 mb-3">by {skin.author || 'Unknown'}</p>
                <button
                  onClick={() => onInstall(skin)}
                  disabled={isInstalled}
                  className={cn(
                    'w-full px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                    isInstalled
                      ? 'bg-surface-2 text-text-4 cursor-not-allowed'
                      : 'bg-accent text-white hover:opacity-90'
                  )}
                >
                  {isInstalled ? 'Already Installed' : 'Install'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface TokensTabProps {
  tokens: Record<string, TokenDefinition[]>
  loading: boolean
}

function TokensTab({ tokens, loading }: TokensTabProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm text-text-3">Loading token definitions...</span>
      </div>
    )
  }

  const categories = Object.keys(tokens)

  if (categories.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm text-text-3">No token namespace available.</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-text-3">
        Design tokens are CSS custom properties that skins must define. Required tokens are marked with a badge.
      </p>
      {categories.map((cat) => (
        <section key={cat} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-2">{cat}</h3>
          <div className="rounded-lg border border-border-1 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-1 text-text-3">
                  <th className="text-left px-3 py-2 font-medium">Token</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium w-24">Default</th>
                  <th className="text-center px-3 py-2 font-medium w-16">Req.</th>
                </tr>
              </thead>
              <tbody>
                {tokens[cat].map((tok) => (
                  <tr key={tok.key} className="border-t border-border-1 hover:bg-surface-1/50 transition-colors">
                    <td className="px-3 py-1.5 font-mono text-accent">{tok.key}</td>
                    <td className="px-3 py-1.5 text-text-2">{tok.description}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {tok.default.startsWith('#') && (
                          <span
                            className="w-3 h-3 rounded-sm border border-white/10 inline-block"
                            style={{ backgroundColor: tok.default }}
                          />
                        )}
                        <span className="font-mono text-text-3 truncate">{tok.default}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {tok.required ? (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent/15 text-accent rounded">yes</span>
                      ) : (
                        <span className="text-text-4">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
