import { useCallback, useEffect, useState } from 'react'
import { Plus, Power, AlertTriangle, ChevronDown, ChevronRight, Trash2, Cpu, LayoutPanelLeft, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePluginsStore, type PluginInstance } from '@/stores/plugins'
import {
  getPlugins,
  enablePlugin,
  disablePlugin,
  installPlugin,
  uninstallPlugin,
} from '@/lib/plugins-api'
import { PluginSettings } from './PluginSettings'
import { PluginDevTools } from './PluginDevTools'
import { PluginPanel } from './PluginPanel'

export function PluginManager() {
  const { plugins, setPlugins, setLoading, loading } = usePluginsStore()
  const [view, setView] = useState<'plugins' | 'runtime'>('plugins')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [installMode, setInstallMode] = useState(false)
  const [manifestJson, setManifestJson] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [installError, setInstallError] = useState('')
  const [activePanelPlugin, setActivePanelPlugin] = useState<PluginInstance | null>(null)

  const loadPlugins = useCallback(async () => {
    setLoading(true)
    const all = await getPlugins()
    setPlugins(all)
    setLoading(false)
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

  const handleInstall = async () => {
    if (!manifestJson.trim()) return
    setInstallError('')
    const result = await installPlugin(manifestJson.trim())
    if (result) {
      await loadPlugins()
      setInstallMode(false)
      setManifestJson('')
    } else {
      setInstallError('Plugin manifest is invalid or already installed.')
    }
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
            {view === 'plugins' ? 'Runtime Inspector' : 'Plugin List'}
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

                    {isExpanded ? (
                      <ChevronDown size={14} className="text-text-3 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-text-3 flex-shrink-0" />
                    )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-0 border border-border-1 rounded-xl shadow-2xl w-[500px] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-text-1">Install Plugin</h2>
            <p className="text-xs text-text-3">Paste the plugin manifest JSON below:</p>
            {installError && (
              <div className="rounded border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {installError}
              </div>
            )}
            <textarea
              value={manifestJson}
              onChange={(e) => setManifestJson(e.target.value)}
              className="w-full h-56 px-3 py-2 text-xs font-mono bg-surface-1 border border-border-1 rounded-md text-text-1 focus:outline-none focus:border-accent resize-none"
              placeholder='{"id": "my-plugin", "name": "My Plugin", ...}'
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setInstallMode(false); setManifestJson(''); setInstallError('') }}
                className="px-3 py-1.5 text-xs text-text-2 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={!manifestJson.trim()}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  manifestJson.trim()
                    ? 'bg-accent text-white hover:opacity-90'
                    : 'bg-surface-2 text-text-4 cursor-not-allowed'
                )}
              >
                Install
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
