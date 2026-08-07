import { useState, useEffect, useCallback } from 'react'
import { Search, Download, Upload, Trash2, Copy, Plus, RefreshCw, Eraser, AlertTriangle } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { freeUpSpace, resetLocalData, localUsageBytes, formatBytes } from '@/lib/storageMaintenance'
import {
  StorageDelete,
  StorageGet,
  StorageGetAll,
  StorageList,
  StoragePut,
  type StorageEntry as WailsStorageEntry,
} from '@/wailsjs/go/main/App'
import { cn } from '@/lib/utils'
import { redactSensitiveData } from '@/lib/secretRedaction'

interface StorageEntry {
  key: string
  value: string
}

const STORAGE_BUCKETS = ['workspace', 'collections', 'environments', 'history', 'mock', 'proxy']

function hasWailsStorage() {
  return Boolean((window as unknown as {
    go?: { main?: { App?: { StorageGet?: unknown; StorageList?: unknown; StoragePut?: unknown } } }
  }).go?.main?.App?.StorageGet)
}

function parseStorageValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function stringifyStorageValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function StoragePanel() {
  const port = useServerPort()
  const [tab, setTab] = useState<'browse' | 'search'>('browse')
  const [bucket, setBucket] = useState('workspace')
  const [entries, setEntries] = useState<StorageEntry[]>([])
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [editValue, setEditValue] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)
  const [localBytes, setLocalBytes] = useState(() => localUsageBytes())

  const wailsApi = useCallback(async (path: string, body?: unknown) => {
    if (!hasWailsStorage()) {
      throw new Error('Storage backend is not reachable. Start the app through Wails or reload after the sidecar is ready.')
    }
    const [route, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    const bucketName = params.get('bucket') || (body as { bucket?: string } | undefined)?.bucket || bucket
    const key = params.get('key') || (body as { key?: string } | undefined)?.key || ''

    if (route === '/storage/status') {
      const all = await Promise.all(STORAGE_BUCKETS.map(async (name) => {
        try {
          const entries = await StorageGetAll(name)
          return { bucket: name, entries }
        } catch {
          return { bucket: name, entries: [] as WailsStorageEntry[] }
        }
      }))
      const totalKeys = all.reduce((sum, item) => sum + item.entries.length, 0)
      const sizeBytes = all.reduce((sum, item) => sum + item.entries.reduce((inner, entry) => inner + entry.value.length, 0), 0)
      return { buckets: all.filter((item) => item.entries.length > 0).length, totalKeys, sizeBytes, mode: 'wails-fallback' }
    }
    if (route === '/storage/list') return { bucket: bucketName, keys: await StorageList(bucketName, '') }
    if (route === '/storage/get') return parseStorageValue(await StorageGet(bucketName, key))
    if (route === '/storage/put') {
      const payload = body as { bucket?: string; key?: string; value?: string }
      await StoragePut(payload.bucket || bucketName, payload.key || key, payload.value ?? '')
      return { ok: true }
    }
    if (route === '/storage/delete') {
      const payload = body as { bucket?: string; key?: string }
      await StorageDelete(payload.bucket || bucketName, payload.key || key)
      return { ok: true }
    }
    if (route === '/storage/export') {
      const entries = await StorageGetAll(bucketName)
      return redactSensitiveData(Object.fromEntries(entries.map((entry) => [entry.key, parseStorageValue(entry.value)])))
    }
    if (route === '/storage/import') {
      const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
      await Promise.all(Object.entries(data).map(([itemKey, value]) => StoragePut(bucketName, itemKey, stringifyStorageValue(value))))
      return { ok: true, imported: Object.keys(data).length }
    }
    if (route === '/storage/search') {
      const q = (params.get('q') || '').toLowerCase()
      const hits: Array<{ bucket: string; key: string; value: string }> = []
      for (const name of STORAGE_BUCKETS) {
        const entries = await StorageGetAll(name).catch(() => [] as WailsStorageEntry[])
        for (const entry of entries) {
          if (entry.key.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q)) {
            hits.push({ bucket: name, key: entry.key, value: entry.value.slice(0, 200) })
            if (hits.length >= 50) break
          }
        }
        if (hits.length >= 50) break
      }
      return { q, results: hits, count: hits.length }
    }
    throw new Error(`Unsupported storage route: ${route}`)
  }, [bucket])

  const api = useCallback(async (path: string, body?: unknown, method?: string) => {
    const url = serverUrl(port, path)
    if (!url) return wailsApi(path, body)
    try {
      const [route] = path.split('?')
      let target = url
      let requestBody: BodyInit | undefined
      let headers: HeadersInit | undefined
      const requestMethod = method ?? (body !== undefined ? 'POST' : 'GET')

      if (route === '/storage/put') {
        const payload = body as { bucket?: string; key?: string; value?: string }
        target = serverUrl(port, `/storage/put?bucket=${encodeURIComponent(payload.bucket ?? '')}&key=${encodeURIComponent(payload.key ?? '')}`)
        requestBody = payload.value ?? ''
      } else if (route === '/storage/delete') {
        const payload = body as { bucket?: string; key?: string }
        target = serverUrl(port, `/storage/delete?bucket=${encodeURIComponent(payload.bucket ?? '')}&key=${encodeURIComponent(payload.key ?? '')}`)
      } else if (route === '/storage/import') {
        target = serverUrl(port, `/storage/import?bucket=${encodeURIComponent(bucket)}`)
        headers = { 'Content-Type': 'application/json' }
        requestBody = JSON.stringify(body ?? {})
      } else {
        headers = body !== undefined ? { 'Content-Type': 'application/json' } : undefined
        requestBody = body !== undefined ? JSON.stringify(body) : undefined
      }

      const res = await sidecarFetch(target, {
        method: requestMethod,
        headers,
        body: requestBody,
      })
      const text = await res.text()
      if (!res.ok) throw new Error(text || res.statusText)
      return text ? parseStorageValue(text) : {}
    } catch (error) {
      if (error instanceof TypeError && String(error.message).includes('Failed to fetch')) {
        return wailsApi(path, body)
      }
      throw error
    }
  }, [bucket, port, wailsApi])

  const loadStatus = useCallback(async () => {
    try {
      const data = await api('/storage/status')
      setStatus(data)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [api])

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api(`/storage/list?bucket=${encodeURIComponent(bucket)}`)
      const names = data?.keys || data || []
      if (Array.isArray(names)) {
        const items: StorageEntry[] = []
        for (const key of names) {
          try {
            const item = await api(`/storage/get?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`)
            items.push({ key, value: typeof item === 'string' ? item : JSON.stringify(item, null, 2) })
          } catch { items.push({ key, value: '<<error reading>>' }) }
        }
        setEntries(items)
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }, [api, bucket])

  useEffect(() => {
    if (port || hasWailsStorage()) {
      loadStatus()
      loadEntries()
    }
  }, [port, loadStatus, loadEntries])

  const handleSelect = (key: string, value: string) => {
    setSelectedKey(key)
    setEditValue(value)
    setMsg('')
  }

  const handleSave = async () => {
    try {
      await api('/storage/put', { bucket, key: selectedKey, value: editValue })
      setMsg(`Saved ${selectedKey}`)
      loadEntries()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const handleDelete = () => {
    setConfirmDeleteOpen(true)
  }

  const confirmDelete = async () => {
    setConfirmDeleteOpen(false)
    try {
      await api('/storage/delete', { bucket, key: selectedKey })
      setMsg(`Deleted ${selectedKey}`)
      setSelectedKey('')
      setEditValue('')
      loadEntries()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const handleAdd = async () => {
    if (!newKey.trim()) return
    try {
      await api('/storage/put', { bucket, key: newKey.trim(), value: newValue })
      setMsg(`Added ${newKey.trim()}`)
      setNewKey('')
      setNewValue('')
      loadEntries()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const handleSearch = async () => {
    if (!searchQuery) return
    setLoading(true)
    setError('')
    try {
      const data = await api(`/storage/search?q=${encodeURIComponent(searchQuery)}`)
      setSearchResults(data)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setLoading(false)
  }

  const handleExport = async () => {
    try {
      const data = await api(`/storage/export?bucket=${encodeURIComponent(bucket)}`)
      const blob = new Blob([JSON.stringify(redactSensitiveData(data), null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `adomnia-storage-export.json`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        await api('/storage/import', JSON.parse(text))
        setMsg('Import completed')
        loadEntries()
        loadStatus()
      } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    }
    input.click()
  }

  const handleSnapshot = async () => {
    const url = serverUrl(port, '/storage/snapshot')
    if (!url) return
    try {
      const res = await sidecarFetch(url)
      const blob = await res.blob()
      if (!res.ok) throw new Error(await blob.text())
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `adomnia-${new Date().toISOString().slice(0, 10)}.adomnia-snapshot`
      a.click()
      URL.revokeObjectURL(href)
      setMsg('Redacted storage snapshot exported')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const chooseRestore = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.adomnia-snapshot,.json'
    input.onchange = (event) => setRestoreFile((event.target as HTMLInputElement).files?.[0] ?? null)
    input.click()
  }

  const confirmRestore = async () => {
    if (!restoreFile) return
    const file = restoreFile
    setRestoreFile(null)
    const url = serverUrl(port, '/storage/restore')
    if (!url) return
    try {
      const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await file.text() })
      const text = await res.text()
      if (!res.ok) throw new Error(text || res.statusText)
      setSelectedKey('')
      setEditValue('')
      setMsg('Snapshot restored. Storage view refreshed.')
      await Promise.all([loadStatus(), loadEntries()])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const migrateLegacyStorage = async () => {
    if (!port) return
    try {
      const data = await api('/storage/migrate', {
        workspace: localStorage.getItem('adomnia.v2') ?? '',
        settings: localStorage.getItem('adomnia.settings') ?? '',
        mock: localStorage.getItem('adomnia.mock') ?? '',
      })
      setMsg(`Legacy migration completed${data?.imported ? `: ${data.imported} entries` : ''}`)
      await Promise.all([loadStatus(), loadEntries()])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-auto">
        {/* Status bar */}
        <div className="flex items-center gap-4 text-[10px] text-text-3 bg-surface-1 border border-border-1 rounded-md px-3 py-2 font-mono">
            {status ? <>
              <span>buckets: <span className="text-text-2">{String(status.buckets ?? '?')}</span></span>
              <span>total keys: <span className="text-text-2">{String(status.totalKeys ?? '?')}</span></span>
              <span>size: <span className="text-text-2">{String(status.sizeBytes ?? '?')}</span></span>
            </> : <span className="text-text-4">Storage backend not connected</span>}
            <button onClick={() => void handleSnapshot()} disabled={!port} className="ml-auto flex items-center gap-1 text-accent hover:text-accent-light disabled:opacity-40"><Download size={11} /> Full snapshot</button>
            <button onClick={chooseRestore} disabled={!port} className="flex items-center gap-1 text-text-3 hover:text-text-1 disabled:opacity-40"><Upload size={11} /> Restore</button>
            <button onClick={() => void migrateLegacyStorage()} disabled={!port} className="text-text-3 hover:text-text-1 disabled:opacity-40">Migrate legacy</button>
            <button onClick={loadStatus} className="text-accent hover:text-accent-light"><RefreshCw size={11} /></button>
        </div>

        {/* Local app cache (localStorage) maintenance */}
        <div className="flex items-center gap-3 text-[10px] text-text-3 bg-surface-1 border border-border-1 rounded-md px-3 py-2 font-mono">
          <span>local cache: <span className="text-text-2">{formatBytes(localBytes)}</span></span>
          <span className="text-text-4">histories · caches · UI state</span>
          <button
            onClick={() => { const f = freeUpSpace(); setLocalBytes(localUsageBytes()); setMsg(`Freed ${formatBytes(f)} of local cache`) }}
            className="ml-auto flex items-center gap-1 text-accent hover:text-accent-light"
            title="Clear call/response history and caches"
          >
            <Eraser size={11} /> Free up space
          </button>
          <button
            onClick={() => setConfirmResetOpen(true)}
            className="flex items-center gap-1 text-error/80 hover:text-error"
            title="Wipe all local adOmnia data and reload"
          >
            <Trash2 size={11} /> Reset local data
          </button>
        </div>

        {(error || msg) && (
          <div className={cn('px-3 py-2 rounded-md text-xs', error ? 'bg-error/10 text-error border border-error/30' : 'bg-success/10 text-success border border-success/30')}>
            {error || msg}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-0.5 border-b border-border-1">
          <button onClick={() => setTab('browse')} className={cn('px-3 py-2 text-xs font-medium border-b-2 -mb-px', tab === 'browse' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-2')}>Browse</button>
          <button onClick={() => setTab('search')} className={cn('px-3 py-2 text-xs font-medium border-b-2 -mb-px', tab === 'search' ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-2')}>Search</button>
        </div>

        {tab === 'browse' && (
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Left: bucket + keys */}
            <div className="w-56 shrink-0 flex flex-col gap-2">
              <div className="flex gap-1">
                <select value={bucket} onChange={(e) => setBucket(e.target.value)} className="flex-1 h-7 px-2 bg-surface-1 border border-border-2 rounded text-[11px] text-text-1 outline-none">
                  {['workspace', 'collections', 'environments', 'history', 'mock', 'proxy'].map(b => <option key={b}>{b}</option>)}
                </select>
                <button onClick={loadEntries} disabled={loading} className="w-7 h-7 flex items-center justify-center bg-surface-1 border border-border-2 rounded text-text-3 hover:text-text-1">
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex gap-1">
                <button onClick={handleExport} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-3 border border-border-2 rounded hover:text-text-1">
                  <Download size={10} /> Export
                </button>
                <button onClick={handleImport} className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-3 border border-border-2 rounded hover:text-text-1">
                  <Upload size={10} /> Import
                </button>
              </div>
              <div className="flex-1 overflow-y-auto bg-surface-1 border border-border-1 rounded-md">
                {entries.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-text-4 text-center">{loading ? 'Loading…' : 'No entries'}</div>
                ) : (
                  entries.map((e) => (
                    <button key={e.key} onClick={() => handleSelect(e.key, e.value)}
                      className={cn('w-full text-left px-3 py-1.5 text-[10px] border-b border-border-1/30 truncate font-mono',
                        selectedKey === e.key ? 'bg-accent/10 text-text-1' : 'text-text-3 hover:bg-surface-2')}>
                      {e.key}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: editor */}
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {selectedKey ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-1 truncate">{bucket}/{selectedKey}</span>
                    <div className="flex-1" />
                    <button onClick={handleSave} className="px-2 py-1 bg-accent text-white rounded text-[10px] font-medium hover:bg-accent-hover">Save</button>
                    <button onClick={handleDelete} className="px-2 py-1 border border-border-2 rounded text-[10px] text-text-3 hover:text-error flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                    <button onClick={() => navigator.clipboard.writeText(editValue)} className="px-2 py-1 border border-border-2 rounded text-[10px] text-text-3 hover:text-text-1"><Copy size={10} /></button>
                  </div>
                  <div className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
                    Editing raw storage can change workspace, collection, mock, proxy or environment data immediately. Export a backup before destructive edits.
                  </div>
                  <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 min-h-[200px] p-3 bg-surface-1 border border-border-2 rounded-md text-xs text-text-1 font-mono outline-none focus:border-accent resize-none"
                    spellCheck={false} />
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] text-text-4">Add new entry</div>
                  <div className="flex gap-2">
                    <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent" />
                    <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value (JSON)" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono outline-none focus:border-accent" />
                    <button onClick={handleAdd} disabled={!newKey.trim()} className="px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40 flex items-center gap-1">
                      <Plus size={11} /> Add
                    </button>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-xs text-text-4">Select a key to view/edit</div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'search' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                placeholder="Search across all storage..." className="flex-1 h-8 px-3 bg-surface-1 border border-border-2 rounded text-xs text-text-1 outline-none focus:border-accent" />
              <button onClick={handleSearch} disabled={!searchQuery} className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-xs font-medium disabled:opacity-40">
                <Search size={11} /> Search
              </button>
            </div>
            {searchResults && (
              <div className="bg-surface-1 border border-border-1 rounded-md overflow-hidden">
                <div className="px-3 py-1.5 border-b border-border-1 text-[10px] text-text-4 uppercase tracking-wider flex items-center justify-between">
                  Results
                  <button onClick={() => navigator.clipboard.writeText(JSON.stringify(searchResults, null, 2))}
                    className="flex items-center gap-1 text-accent hover:text-accent-light"><Copy size={10} /> Copy</button>
                </div>
                <pre className="p-3 text-xs text-text-2 font-mono whitespace-pre-wrap overflow-auto max-h-72">
                  {JSON.stringify(searchResults, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDeleteOpen(false)}>
          <div
            className="bg-surface-1 border border-border-2 rounded-lg shadow-xl p-4 max-w-xs w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-text-1 mb-4">Delete &quot;{selectedKey}&quot;?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-3 py-1 text-xs rounded border border-border-2 text-text-2 hover:text-text-1 hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-3 py-1 text-xs rounded bg-error/20 border border-error/40 text-error hover:bg-error/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmResetOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border border-error/40 bg-surface-1 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="flex items-center gap-2 text-sm font-semibold text-text-1"><AlertTriangle size={15} className="text-error" /> Reset all local data?</p>
            <p className="mt-2 text-xs leading-5 text-text-3">
              This wipes every local adOmnia setting, collection, environment, tab, history and cache stored in this browser, then reloads. Backend storage (bbolt) is not touched. <strong className="text-text-2">Export a workspace or snapshot first if you might need it back.</strong>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmResetOpen(false)} className="rounded border border-border-2 px-3 py-1 text-xs text-text-2 hover:bg-surface-2">Cancel</button>
              <button onClick={() => resetLocalData()} className="rounded border border-error/40 bg-error/20 px-3 py-1 text-xs font-medium text-error hover:bg-error/30">Reset &amp; reload</button>
            </div>
          </div>
        </div>
      )}

      {restoreFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRestoreFile(null)}>
          <div className="w-full max-w-sm rounded-lg border border-border-2 bg-surface-1 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-text-1">Restore full storage snapshot?</p>
            <p className="mt-2 text-xs leading-5 text-text-3"><span className="font-mono text-text-2">{restoreFile.name}</span> will replace matching local bbolt entries. Export a current snapshot first if you may need to roll back.</p>
            <div className="mt-4 flex justify-end gap-2"><button onClick={() => setRestoreFile(null)} className="rounded border border-border-2 px-3 py-1 text-xs text-text-2">Cancel</button><button onClick={() => void confirmRestore()} className="rounded border border-warning/40 bg-warning/20 px-3 py-1 text-xs font-medium text-warning">Restore snapshot</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
