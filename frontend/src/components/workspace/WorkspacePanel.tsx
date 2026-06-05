import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Download, FileCode, FolderOpen, LogIn, RefreshCw, Save, Shield, ShieldAlert, Trash2, Undo2, Upload } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { cn } from '@/lib/utils'
import { parseInteropFile, redactSecrets, summarizeBundle, type InteropBundle } from '@/lib/interopHub'
import { scanWorkspace, maskSecretValues } from '@/lib/secretScanner'
import { loadFlowDefinitions, type SavedFlowDefinition } from '@/lib/flowStorage'
import { applyWorkspaceState, type WorkspaceState } from '@/lib/workspaceState'
import { rememberRecentWorkspace, removeRecentWorkspace, type WorkspaceMeta } from '@/lib/workspaceRecents'
import { OasImportModal } from './OasImportModal'

export function WorkspacePanel() {
  const port = useServerPort()
  const [name, setName] = useState('default')
  const [workspaces, setWorkspaces] = useState<WorkspaceMeta[]>([])
  const [loadedState, setLoadedState] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [importBundle, setImportBundle] = useState<InteropBundle | null>(null)
  const [undoState, setUndoState] = useState<string | null>(null)
  const [exportConfirm, setExportConfirm] = useState<{ state: string; secrets: number } | null>(null)
  const [flowDefinitions, setFlowDefinitions] = useState<SavedFlowDefinition[]>([])
  const [showOasImport, setShowOasImport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const makeState = () => {
    const collectionState = useCollectionsStore.getState()
    const workspaceId = collectionState.activeWorkspaceId
    const activeWorkspace = collectionState.workspaces.find((workspace) => workspace.id === workspaceId)
    const workspaceTabs = useTabsStore.getState().tabs.filter((tab) => (tab.workspaceId ?? workspaceId) === workspaceId)
    const activeTabId = useTabsStore.getState().activeTabId
    return JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      workspace: activeWorkspace ? { id: activeWorkspace.id, name: activeWorkspace.name } : undefined,
      openTabs: workspaceTabs,
      activeTabId: workspaceTabs.some((tab) => tab.id === activeTabId) ? activeTabId : workspaceTabs[0]?.id ?? null,
      collections: collectionState.collections,
      environments: useEnvironmentsStore.getState().environments,
      activeEnvId: useEnvironmentsStore.getState().activeEnvId,
      settings: useSettingsStore.getState().settings,
      websocket: (() => { try { const raw = localStorage.getItem('adomnia.websocket'); return raw ? JSON.parse(raw) : null } catch { return null } })(),
      flows: flowDefinitions,
      dockerLab: (() => { try { const raw = localStorage.getItem('adomnia.dockerlab.last'); return raw ? JSON.parse(raw) : null } catch { return null } })(),
    }, null, 2)
  }

  const api = useCallback(async (path: string, body?: unknown) => {
    const url = serverUrl(port, path)
    if (!url) throw new Error('Backend not ready')
    const res = await sidecarFetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(text || res.statusText)
    return text ? JSON.parse(text) : {}
  }, [port])

  const refresh = useCallback(async () => {
    try {
      const data = await api('/workspace/list')
      setWorkspaces(data.workspaces ?? [])
    } catch (e) {
      setError(String(e))
    }
  }, [api])

  useEffect(() => {
    if (port) refresh()
  }, [port, refresh])

  useEffect(() => {
    void loadFlowDefinitions().then(setFlowDefinitions)
  }, [])

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    }
  }

  const save = () => run(async () => {
    const state = makeState()
    const data = await api('/workspace/save', { name, state })
    setMessage(`Saved "${data.name}" with ${data.tabs ?? 0} tabs`)
    setLoadedState(state)
    refresh()
  })

  const load = (wsName?: string) => run(async () => {
    const target = wsName ?? workspaces[0]?.name
    const path = target ? `/workspace/load?name=${encodeURIComponent(target)}` : '/workspace/load'
    const state = await api(path) as WorkspaceState
    const text = JSON.stringify(state, null, 2)
    setLoadedState(text)
    const restoredFlows = await applyWorkspaceState(state)
    if (restoredFlows) setFlowDefinitions(restoredFlows)
    const meta = target && workspaces.find((workspace) => workspace.name === target)
    if (meta) rememberRecentWorkspace(meta)
    setMessage('Workspace loaded into the frontend')
  })

  const remove = (wsName: string) => run(async () => {
    await api(`/workspace/delete?name=${encodeURIComponent(wsName)}`)
    removeRecentWorkspace(wsName)
    setMessage(`Deleted "${wsName}"`)
    refresh()
  })

  const loadDemo = () => run(async () => {
    const colStore = useCollectionsStore.getState()
    const envStore = useEnvironmentsStore.getState()

    if (colStore.collections.some((c) => c.id === 'col-forgecore')) {
      setError('Demo workspace already loaded')
      return
    }

    const { getForgeCoreCollections, getForgeCoreEnvironments, getForgeCoreActiveEnvId } = await import('@/lib/demoWorkspace')

    const cols = getForgeCoreCollections()
    for (const col of cols) {
      colStore.importCollection(col)
    }

    const envs = getForgeCoreEnvironments()
    useEnvironmentsStore.setState({ environments: envs, activeEnvId: getForgeCoreActiveEnvId(), loaded: true })
    envStore.save()

    setMessage('ForgeCore Gateway API demo loaded')
    refresh()
  })

  const handleInteropFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setMessage('')
    try {
      setImportBundle(parseInteropFile(file.name, await file.text()))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setImportBundle(null)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const applyImport = () => {
    if (!importBundle) return
    setUndoState(makeState())
    const colStore = useCollectionsStore.getState()
    const envStore = useEnvironmentsStore.getState()

    for (const imported of importBundle.collections) {
      const duplicate = colStore.collections.some((col) => col.name === imported.name)
      colStore.importCollection(duplicate ? { ...imported, id: `${imported.id}-${Date.now()}`, name: `${imported.name} Import` } : imported)
    }
    if (importBundle.environments.length) {
      useEnvironmentsStore.setState((state) => ({
        environments: [
          ...state.environments,
          ...importBundle.environments.map((env) => ({
            ...env,
            id: state.environments.some((current) => current.name === env.name) ? `${env.id}-${Date.now()}` : env.id,
            name: state.environments.some((current) => current.name === env.name) ? `${env.name} Import` : env.name,
          })),
        ],
        activeEnvId: state.activeEnvId ?? importBundle.environments[0]?.id ?? null,
        loaded: true,
      }))
      envStore.save()
    }
    setMessage(`Imported ${importBundle.collections.length} collection(s), ${importBundle.environments.length} environment(s), ${importBundle.artifacts.length} artifact(s).`)
    setImportBundle(null)
  }

  const undoImport = () => {
    if (!undoState) return
    const state = JSON.parse(undoState)
    if (Array.isArray(state.collections)) {
      useCollectionsStore.getState().replaceCollections(state.collections)
    }
    if (Array.isArray(state.environments)) {
      useEnvironmentsStore.setState({ environments: state.environments, activeEnvId: state.activeEnvId ?? null, loaded: true })
      useEnvironmentsStore.getState().save()
    }
    setMessage('Last import undone.')
    setUndoState(null)
  }

  const exportWorkspaceFile = () => {
    const state = makeState()
    // Pre-export secret scan
    const collections = useCollectionsStore.getState().collections
    const environments = useEnvironmentsStore.getState().environments
    const scan = scanWorkspace({ collections, environments })
    if (scan.totalFindings > 0) {
      setExportConfirm({ state, secrets: scan.totalFindings })
      return
    }
    downloadExport(state)
  }

  const downloadExport = (state: string) => {
    const blob = new Blob([state], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `adomnia-workspace-${new Date().toISOString().slice(0, 10)}.adomnia.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportMasked = () => {
    if (!exportConfirm) return
    const parsed = JSON.parse(exportConfirm.state)
    const masked = maskSecretValues(parsed)
    downloadExport(JSON.stringify(masked, null, 2))
    setExportConfirm(null)
  }

  const exportUnmasked = () => {
    if (!exportConfirm) return
    downloadExport(exportConfirm.state)
    setExportConfirm(null)
  }

  const importSummary = importBundle ? summarizeBundle(importBundle) : null

  return (
    <div className="flex-1 grid grid-cols-[300px_1fr] min-h-0 overflow-hidden">
      {/* Left panel */}
      <div className="border-r border-border-1 flex flex-col min-h-0">
        {/* Header + actions */}
        <div className="p-4 border-b border-border-1 flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-accent" />
            <h2 className="text-xs font-semibold text-text-2">Saved workspace snapshots</h2>
            <button onClick={refresh} className="ml-auto w-6 h-6 flex items-center justify-center text-text-4 hover:text-text-1 hover:bg-surface-2 rounded-md transition-colors" title="Refresh">
              <RefreshCw size={13} />
            </button>
          </div>

          {/* Save input */}
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name) save() }}
              placeholder="workspace name…"
              className="flex-1 h-8 px-2.5 bg-surface-2 border border-border-2 rounded-lg text-xs text-text-1 outline-none focus:border-accent placeholder:text-text-4"
            />
            <button
              onClick={save}
              disabled={!name}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold disabled:opacity-50 shadow-[0_0_12px_var(--color-accent-glow)] disabled:shadow-none transition-all"
            >
              <Save size={11} /> Save
            </button>
          </div>

          <button
            onClick={() => load()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-border-2 rounded-lg text-xs text-text-3 hover:text-text-1 hover:border-border-1 transition-colors"
          >
            <Clock size={11} /> Load Last Saved State
          </button>

          <button
            onClick={loadDemo}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-accent/10 hover:bg-accent/18 text-accent border border-accent/25 rounded-lg text-xs font-semibold transition-colors"
          >
            <Download size={11} /> Load ForgeCore Demo
          </button>

          <div className="grid grid-cols-2 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".json,.yaml,.yml,.har,.curl,.http,.rest,.env,.graphql,.gql,.proto,.wsdl,.bru,.adomnia"
              onChange={(event) => void handleInteropFile(event.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border-2 px-3 py-2 text-xs text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
            >
              <Upload size={11} /> Import any
            </button>
            <button
              onClick={exportWorkspaceFile}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border-2 px-3 py-2 text-xs text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
            >
              <Download size={11} /> Export workspace
            </button>
          </div>

          <button
            onClick={() => setShowOasImport(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-2 px-3 py-2 text-xs text-text-3 transition-colors hover:border-accent/40 hover:text-text-1"
            title="Import an OpenAPI 3.x or Swagger 2.x spec (file, URL, or paste) as a collection"
          >
            <FileCode size={11} /> Import OAS
          </button>

          <button
            onClick={undoImport}
            disabled={!undoState}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-2 px-3 py-2 text-xs text-text-3 transition-colors hover:text-text-1 disabled:opacity-40"
          >
            <Undo2 size={11} /> Undo last import
          </button>
        </div>

        {(message || error) && (
          <div className={cn(
            'px-4 py-2 text-xs border-b shrink-0',
            error ? 'text-error border-error/30 bg-error/8' : 'text-success border-border-1 bg-surface-1',
          )}>
            {error || message}
          </div>
        )}

        {importBundle && importSummary && (
          <div className="border-b border-border-1 bg-surface-1 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Upload size={13} className="text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-text-1">{importBundle.sourceName}</div>
                <div className="text-[10px] text-text-4">
                  {importSummary.format} · {importSummary.collections} collection(s) · {importSummary.requests} request(s) · {importSummary.environments} env(s)
                </div>
              </div>
            </div>
            {importSummary.secretsDetected > 0 && (
              <div className="mb-2 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
                Secrets detected. Preview is redacted; imported secrets keep their local values.
              </div>
            )}
            {importSummary.warnings.map((warning) => (
              <div key={warning} className="mb-2 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">{warning}</div>
            ))}
            <pre className="max-h-44 overflow-auto rounded border border-border-1 bg-surface-0 p-2 text-[10px] text-text-3">
              {JSON.stringify(redactSecrets(importBundle), null, 2)}
            </pre>
            <div className="mt-2 flex gap-2">
              <button onClick={applyImport} className="flex-1 rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white">Apply import</button>
              <button onClick={() => setImportBundle(null)} className="rounded border border-border-2 px-3 py-1.5 text-xs text-text-3 hover:text-text-1">Cancel</button>
            </div>
          </div>
        )}

        {/* Workspace list */}
        <div className="overflow-y-auto flex-1">
          {workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
              <FolderOpen size={24} className="text-text-4 opacity-40" />
              <p className="text-xs text-text-4">No saved snapshots yet</p>
              <p className="text-[10px] text-text-4">Save a point-in-time backup of the active workspace</p>
            </div>
          ) : (
            workspaces.map((ws) => (
              <div key={ws.name} className="flex items-start gap-2 px-3 py-3 border-b border-border-1/50 hover:bg-surface-1 transition-colors group">
                <button onClick={() => setName(ws.name)} className="flex-1 text-left min-w-0">
                  <div className="text-xs text-text-1 font-medium truncate">{ws.name}</div>
                  <div className="text-[10px] text-text-4 mt-0.5">
                    {ws.tabs} tab{ws.tabs !== 1 ? 's' : ''} · {new Date(ws.updatedAt).toLocaleString()}
                  </div>
                </button>
                <button
                  onClick={() => load(ws.name)}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-text-4 hover:text-accent rounded-md transition-all"
                  title="Load this workspace"
                >
                  <LogIn size={12} />
                </button>
                <button
                  onClick={() => remove(ws.name)}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-text-4 hover:text-error rounded-md transition-all"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Export confirmation modal */}
      {exportConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-[440px] bg-surface-0 border border-border-2 rounded-lg shadow-2xl overflow-hidden">
            <div className="flex items-center h-8 px-3 gap-2 border-b border-border-1 bg-yellow-500/5">
              <ShieldAlert size={14} className="text-yellow-400" />
              <span className="text-[10px] font-semibold text-text-1 uppercase tracking-wider">
                Secrets Detected
              </span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-text-2">
                <strong className="text-yellow-400">{exportConfirm.secrets} potential secret{exportConfirm.secrets > 1 ? 's' : ''}</strong> found in your workspace &mdash;
                including API keys, tokens, passwords, or private keys.
              </p>
              <ul className="space-y-1 text-[10px] text-text-3">
                <li className="flex items-start gap-1.5">
                  <Shield size={10} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  <span><strong className="text-text-1">Masked export</strong> &mdash; secrets replaced with ***REDACTED***. Safe to share.</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <ShieldAlert size={10} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  <span><strong className="text-text-1">Unmasked export</strong> &mdash; includes all plaintext secrets. Keep this file private.</span>
                </li>
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={exportMasked}
                  className="flex-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Shield size={11} />
                  Export Masked
                </button>
                <button
                  onClick={exportUnmasked}
                  className="flex-1 rounded bg-yellow-500/10 border border-yellow-500/30 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/20 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert size={11} />
                  Export Unmasked
                </button>
              </div>
              <button
                onClick={() => setExportConfirm(null)}
                className="w-full text-[10px] text-text-3 hover:text-text-1 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right: JSON preview */}
      <div className="flex flex-col min-w-0 min-h-0">
        <div className="px-4 py-2.5 border-b border-border-1 text-[10px] font-semibold text-text-4 uppercase tracking-wider shrink-0">
          Current / Loaded Workspace JSON
        </div>
        <textarea
          value={loadedState || makeState()}
          onChange={(e) => setLoadedState(e.target.value)}
          className="flex-1 p-4 bg-surface-0 text-text-1 text-xs font-mono resize-none outline-none"
        />
      </div>

      {showOasImport && (
        <OasImportModal
          onClose={() => setShowOasImport(false)}
          onImported={(collectionName) => setMessage(`Imported OpenAPI spec "${collectionName}" as a collection.`)}
        />
      )}
    </div>
  )
}
