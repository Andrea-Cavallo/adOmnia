import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DATABASE_PENDING_CONNECTION_KEY, takeDatabaseQueryHandoff } from '@/lib/moduleHandoff'
import { Braces, CheckCircle2, Database, LayoutList, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { visibleInterval } from '@/lib/visiblePolling'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { confirm } from '@/lib/confirmDialog'
import { useResolvedVars } from '@/stores/environments'
import { useAppStore } from '@/stores/app'
import { safeStorageGet, safeStoragePut } from '@/lib/wailsStorage'
import { StoragePut } from '@/wailsjs/go/main/App'
import { ConnectionsSidebar } from './ConnectionsSidebar'
import { QueryEditor, type RunScope, type SnippetRequest } from './QueryEditor'
import { QueryConsole } from './QueryConsole'
import { ResultsView } from './ResultsView'
import { sqlAliases } from './sqlComplete'
import { countRewrite, interpret, splitStatements, type DbKind, type QueryInterpretation } from './queryInterpreter'
import { useDbSchema } from './useDbSchema'
import { AiQueryAssistant } from './AiQueryAssistant'
import type { AiSchemaTable } from './aiQuerySuggest'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useSettingsStore } from '@/stores/settings'
import {
  SAVED_QUERIES_KEY, addSavedQuery, createHistoryRecord, createSavedQuery, exportSavedQueries, filterSavedQueries, importSavedQueries,
  MAX_HISTORY, mergeSavedQueries, migrateFavorites, migrateHistory, normalizeSavedQueries, queryFamily, removeSavedQuery, renameSavedQuery, setPersonal,
  type SavedQuery,
} from './savedQueries'
import { RightRail } from './RightRail'
import { MongoWorkspace } from './mongo/MongoWorkspace'
import { toEditable } from './mongo/bson'
import { ResizeHandle } from '@/components/ui/ResizeHandle'
import { useResizableSize } from '@/hooks/useResizableSize'
import {
  CONNECTIONS_KEY, DRIVER_META, FAVORITES_KEY, HISTORY_KEY, MONGO_DEFAULT_QUERY,
  SQL_DEFAULT_QUERY, REDIS_DEFAULT_QUERY, isDangerousRedis, STORAGE_BUCKET, WORKSPACE_KEY,
  blankConnection, blankTab, browseQuery, columnsQuery, countQuery, csvEscape, download,
  createObjectQuery, defaultConnectionName, extractColumns, extractCount, extractNames, introspectionQuery,
  isDangerous, isDangerousMongo, nextQueryName, normalizeConnection, parseQueryWorkspace, substituteVars, validateConnection,
  type DbConnection, type DbDriver, type DbResult, type HistoryItem, type QueryTab, type QueryWorkspaceState, type SchemaColumn, type SchemaItem,
  upsertConnectionFromRef,
} from './dbShared'
import {
  clearDatabaseConnectionSecrets,
  hydrateDatabaseConnections,
  protectDatabaseConnection,
  serializeDatabaseConnections,
  sealDatabaseConnection,
} from './dbSecrets'
import { useEntityHandoff } from '@/lib/entities/dispatch'
import { showEntityNotice } from '@/lib/entities/notice'

export function DatabasePanel() {
  const connectionsPane = useResizableSize({ storageKey: 'adomnia.database.connectionsWidth', defaultSize: 336, min: 260, maxRatio: 0.4 })
  const rightPane = useResizableSize({ storageKey: 'adomnia.database.sideWidth', defaultSize: 280, min: 220, maxRatio: 0.4, direction: -1 })
  const editorPane = useResizableSize({ storageKey: 'adomnia.database.editorHeight', defaultSize: 320, min: 140, maxRatio: 0.7, axis: 'y' })
  const port = useServerPort()
  const vars = useResolvedVars()

  const [connections, setConnections] = useState<DbConnection[]>([])
  const connectionDrafts = useRef<DbConnection[]>([])
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const saveGeneration = useRef(0)
  const [statuses, setStatuses] = useState<Record<string, { state: string; latencyMs: number; error?: string }>>({})
  const [activeId, setActiveId] = useState('')
  const [tabs, setTabs] = useState<QueryTab[]>([blankTab('Query 1')])
  const [activeTabId, setActiveTabId] = useState(tabs[0].id)
  const [limit, setLimit] = useState(200)
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [result, setResult] = useState<DbResult | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [focusToken, setFocusToken] = useState(0)
  const [mongoView, setMongoView] = useState<'documents' | 'raw'>('documents')
  const [mongoReload, setMongoReload] = useState(0)

  const [schemaItems, setSchemaItems] = useState<SchemaItem[]>([])
  const [schemaColumns, setSchemaColumns] = useState<Record<string, SchemaColumn[]>>({})
  const [schemaDb, setSchemaDb] = useState('')
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [schemaSearch, setSchemaSearch] = useState('')
  const [createObjectOpen, setCreateObjectOpen] = useState(false)
  const [createObjectName, setCreateObjectName] = useState('')
  const [createObjectError, setCreateObjectError] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleTarget, setConsoleTarget] = useState('')
  const [snippetRequest, setSnippetRequest] = useState<SnippetRequest | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const aiSettings = useSettingsStore((s) => s.settings.ai)
  const aiAvailable = isAICompanionAvailable(aiSettings)
  const runMongoRef = useRef<(command: Record<string, unknown>) => Promise<DbResult>>(() => Promise.reject(new Error('Backend not ready')))

  const active = connections.find((c) => c.id === activeId) ?? connections[0] ?? blankConnection()
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const query = activeTab?.query ?? ''
  const isMongo = active.driver === 'mongodb'
  const isRedis = active.driver === 'redis'
  const renderedQuery = useMemo(() => substituteVars(query, vars), [query, vars])
  const queryKind: DbKind | null = active.driver === 'db2' ? null : active.driver
  const connected = statuses[active.id]?.state === 'connected'
  const dbSchema = useDbSchema({
    driver: active.driver, connectionId: active.id, connected, schemaItems, schemaColumns, runMongo: (command) => runMongoRef.current(command),
  })
  const { completionSchema } = dbSchema
  const interpretation = useMemo(
    () => (queryKind && renderedQuery.trim() ? interpret(queryKind, renderedQuery, dbSchema.querySchema) : null),
    [queryKind, renderedQuery, dbSchema.querySchema],
  )
  // The interpreter drives the confirmation; the legacy checks stay as a floor so nothing that asked before stops asking.
  const dangerous = interpretation?.risk === 'destructive'
    || (isRedis ? isDangerousRedis(renderedQuery) : isMongo ? isDangerousMongo(renderedQuery) : isDangerous(renderedQuery))
  // Names only: this is all "Ask AI" ever sends about the database.
  const aiSchema = useMemo<AiSchemaTable[]>(() => {
    if (isRedis) return []
    if (isMongo) return schemaItems.map((t) => ({ name: t.name, columns: (dbSchema.jsonContext?.fields[t.name] ?? []).map((name) => ({ name })) }))
    return schemaItems.map((t) => ({ name: t.name, columns: (schemaColumns[t.name] ?? []).map((c) => ({ name: c.name, type: c.type })) }))
  }, [isMongo, isRedis, schemaItems, schemaColumns, dbSchema.jsonContext])
  const visibleSaved = useMemo(
    () => filterSavedQueries(saved, { family: queryFamily(active.driver), connectionId: active.id }),
    [saved, active.driver, active.id],
  )
  const queryTables = useMemo(
    () => (isMongo || isRedis ? [] : [...new Set(sqlAliases(renderedQuery, completionSchema).values())]),
    [isMongo, isRedis, renderedQuery, completionSchema],
  )

  // A Mongo query that names a collection samples its fields once, so completion and "unknown column" checks have data.
  const namedCollection = isMongo ? /"collection"\s*:\s*"([^"]+)"/.exec(query)?.[1] ?? '' : ''
  useEffect(() => { if (namedCollection) dbSchema.ensureSample(namedCollection) }, [namedCollection, dbSchema.ensureSample])
  const consoleColumns = useMemo(() => {
    if (!consoleTarget) return []
    return isMongo ? (dbSchema.jsonContext?.fields[consoleTarget] ?? []) : (completionSchema[consoleTarget] ?? [])
  }, [consoleTarget, isMongo, dbSchema.jsonContext, completionSchema])
  useEffect(() => { if (isMongo && consoleTarget) dbSchema.ensureSample(consoleTarget) }, [isMongo, consoleTarget, dbSchema.ensureSample])
  useEffect(() => { setConsoleTarget('') }, [active.id])

  // ── auto-dismiss success toast ────────────────────────────────────────────
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(t)
  }, [message])

  // ── load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [rawConnections, rawHistory, rawFavorites, rawWorkspace, rawSaved] = await Promise.all([
        safeStorageGet(STORAGE_BUCKET, CONNECTIONS_KEY),
        safeStorageGet(STORAGE_BUCKET, HISTORY_KEY),
        safeStorageGet(STORAGE_BUCKET, FAVORITES_KEY),
        safeStorageGet(STORAGE_BUCKET, WORKSPACE_KEY),
        safeStorageGet(STORAGE_BUCKET, SAVED_QUERIES_KEY),
      ])
      let nextConnections = [blankConnection()]
      let connectionsWritable = true
      if (rawConnections) {
        try {
          const loaded = JSON.parse(rawConnections) as Partial<DbConnection>[]
          if (Array.isArray(loaded) && loaded.length) {
            nextConnections = hydrateDatabaseConnections(loaded.map(normalizeConnection))

          }
        } catch {
          connectionsWritable = false
          setError('Saved database credentials could not be migrated. Unlock the Vault/keychain and reopen this panel; existing stored data has been preserved.')
        }
      }
      const pendingRaw = sessionStorage.getItem(DATABASE_PENDING_CONNECTION_KEY)
        ?? localStorage.getItem(DATABASE_PENDING_CONNECTION_KEY)
      if (pendingRaw && connectionsWritable) {
        try {
          const pending = JSON.parse(pendingRaw) as Partial<DbConnection>
          const pendingConn = normalizeConnection({ ...pending, id: crypto.randomUUID() })
          // Aprire due volte lo stesso contesto riusa la connessione già creata invece di duplicarla.
          const existing = nextConnections.find((connection) => connection.name === pendingConn.name && connection.driver === pendingConn.driver)
          nextConnections = existing
            ? [existing, ...nextConnections.filter((connection) => connection.id !== existing.id)]
            : [pendingConn, ...nextConnections]
          setMessage(existing ? `Connection "${existing.name}" selected` : `Connection "${pendingConn.name}" added`)
        } catch {
          setError('Could not import the database connection')
        } finally {
          sessionStorage.removeItem(DATABASE_PENDING_CONNECTION_KEY)
          localStorage.removeItem(DATABASE_PENDING_CONNECTION_KEY)
        }
      }
      if (connectionsWritable) {
        try { nextConnections = await Promise.all(nextConnections.map((c) => sealDatabaseConnection(c))); await StoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, serializeDatabaseConnections(nextConnections)); await safeStoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, serializeDatabaseConnections(nextConnections)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save credentials') }
      }
      setConnections(nextConnections)
      connectionDrafts.current = nextConnections
      setActiveId(nextConnections[0]?.id ?? '')
      // Saved queries are records now; the old bare-string favorites migrate once and stay in place for a rollback.
      let loadedSaved: SavedQuery[] = []
      try {
        if (rawSaved) loadedSaved = normalizeSavedQueries(JSON.parse(rawSaved))
        else if (rawFavorites) {
          loadedSaved = migrateFavorites(JSON.parse(rawFavorites))
          if (loadedSaved.length) void safeStoragePut(STORAGE_BUCKET, SAVED_QUERIES_KEY, JSON.stringify(loadedSaved))
        }
      } catch { loadedSaved = [] }
      setSaved(loadedSaved)
      // Cronologia come record (DB-3.4.1): stringhe e `{query, ts, label}` vecchie migrate una volta.
      if (rawHistory) {
        try {
          setHistory(migrateHistory(JSON.parse(rawHistory), nextConnections[0]?.driver ?? ''))
        } catch { setHistory([]) }
      }
      const first = nextConnections[0]
      let restored = false
      if (rawWorkspace) {
        const workspace = parseQueryWorkspace(rawWorkspace)
        if (workspace) {
          setTabs(workspace.tabs)
          setActiveTabId(workspace.activeTabId)
          if (workspace.limit !== undefined) setLimit(workspace.limit)
          if (workspace.timeoutMs !== undefined) setTimeoutMs(workspace.timeoutMs)
          restored = true
        }
      }
      if (!restored && first?.driver === 'mongodb') setTabs([blankTab('Mongo JSON Runner', MONGO_DEFAULT_QUERY)])
      if (!restored && first?.driver === 'redis') setTabs([blankTab('Redis Commands', REDIS_DEFAULT_QUERY)])
      // Una query inviata da Code Studio si apre in una nuova scheda, mai al posto del lavoro in corso.
      const handedQuery = takeDatabaseQueryHandoff()
      if (handedQuery) {
        const tab = blankTab('Code Studio', handedQuery)
        setTabs((current) => [...current, tab])
        setActiveTabId(tab.id)
      }
      setHydrated(true)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => {
      void safeStoragePut(STORAGE_BUCKET, WORKSPACE_KEY, JSON.stringify({ tabs, activeTabId, limit, timeoutMs } satisfies QueryWorkspaceState))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [activeTabId, hydrated, limit, tabs, timeoutMs])

  useEffect(() => { if (tabs[0]) setActiveTabId((id) => (tabs.some((t) => t.id === id) ? id : tabs[0].id)) }, [tabs])

  // ── persistence helpers ─────────────────────────────────────────────────
  const persistConnections = async (next: DbConnection[]) => {
    connectionDrafts.current = next
    setConnections(next)
    const generation = ++saveGeneration.current
    const save = saveQueue.current.catch(() => undefined).then(async () => {
      const sealed = await Promise.all(next.map((c) => sealDatabaseConnection(c)))
      await StoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, serializeDatabaseConnections(sealed))
      await safeStoragePut(STORAGE_BUCKET, CONNECTIONS_KEY, serializeDatabaseConnections(sealed))
      if (generation === saveGeneration.current) { connectionDrafts.current = sealed; setConnections(sealed) }
    })
    saveQueue.current = save
    try { await save } catch (e) { setError(e instanceof Error ? e.message : 'Could not save database credentials'); throw e }
  }

  const updateActive = (patch: Partial<DbConnection>) => {
    void persistConnections(connectionDrafts.current.map((c) => c.id === active.id ? { ...c, ...patch } : c)).catch(() => undefined)
  }

  const setQuery = (q: string) => {
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, query: q } : t))
  }

  const setDriver = (driver: DbDriver) => {
    const automaticName = active.name === 'Local SQLite' || /^(SQLite|PostgreSQL|MySQL|MongoDB|Redis) Connection$/i.test(active.name)
    updateActive({ driver, port: DRIVER_META[driver].port, ...(driver === 'redis' ? { database: '0' } : {}), ...(automaticName ? { name: defaultConnectionName(driver) } : {}) })
    setResult(null)
    setError('')
    setSchemaError('')
    setSchemaItems([])
    setSchemaColumns({})
    if (driver === 'redis') setQuery(REDIS_DEFAULT_QUERY)
    else if (driver === 'mongodb' && (!query.trim().startsWith('{') || isRedis)) setQuery(MONGO_DEFAULT_QUERY)
    else if (driver !== 'mongodb' && query.trim().startsWith('{')) setQuery(SQL_DEFAULT_QUERY)
  }

  const selectConnection = (id: string) => {
    setActiveId(id)
    if (connections.find((c) => c.id === id)?.autoConnect) { void saveQueue.current.then(() => api('/database/connect', { connectionId: id })).catch((e) => setError(String(e))) }
    setResult(null)
    setError('')
    setSchemaItems([])
    setSchemaColumns({})
    setSchemaError('')
  }

  const addConnection = () => {
    const conn = { ...blankConnection(), name: `Local SQLite ${connections.length + 1}` }
    void persistConnections([...connections, conn])
    setActiveId(conn.id)
  }

  useEntityHandoff('database', (ref, intent, payload) => {
    if (!hydrated) return false // never persist before saved connections are loaded
    if (intent === 'connect') {
      const next = upsertConnectionFromRef(connections, ref)
      if (next.created) void persistConnections(next.connections)
      setActiveId(next.id)
      showEntityNotice(next.created
        ? `Connection "${ref.label}" added. Enter the password or load it from the Vault, then connect.`
        : `Switched to the existing connection for ${ref.label}.`)
      return true
    }
    if (intent === 'sql' && typeof payload.sql === 'string') {
      // A statement seen at runtime: opened, never executed, with the way back to its request.
      const tab = blankTab(ref.label, payload.sql)
      setTabs((current) => [...current, tab])
      setActiveTabId(tab.id)
      const back = payload.back as { label: string; run: () => void } | undefined
      showEntityNotice(`Query from ${ref.label}. Pick the service's connection, then run it.`, back)
      return true
    }
    if (intent === 'query') {
      const tab = blankTab(ref.label, `SELECT * FROM ${ref.label} LIMIT 100`)
      setTabs((current) => [...current, tab])
      setActiveTabId(tab.id)
      if (!active || active.driver === 'sqlite') showEntityNotice(`Pick the connection that owns table ${ref.label}, then run the query.`)
      return true
    }
    return true
  })

  const deleteConnection = (id: string) => {
    if (connections.length <= 1) return
    const next = connections.filter((c) => c.id !== id)
    void persistConnections(next)
    void api('/database/disconnect', { connectionId: id }).catch(() => undefined)
    clearDatabaseConnectionSecrets(id)
    if (activeId === id) setActiveId(next[0]?.id ?? '')
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  const addTab = () => {
    const tab = blankTab(nextQueryName(tabs), '')
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setResult(null)
    setError('')
    setLogs([])
    setMessage(`${tab.name} opened`)
    setFocusToken((token) => token + 1)
  }

  // A .sql dropped anywhere in the app opens here as a new query tab (see useFileDrop / globalFileRouter).
  const consumeFileImport = useAppStore((s) => s.consumeFileImport)
  const pendingFileImport = useAppStore((s) => s.pendingFileImport)
  useEffect(() => {
    const routed = consumeFileImport('sql')
    if (routed?.kind !== 'sql') return
    const tab = blankTab(routed.name.replace(/\.sql$/i, '') || nextQueryName(tabs), routed.text)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    setResult(null)
    setError('')
    setLogs([])
    setMessage(`${routed.name} imported`)
    setFocusToken((token) => token + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consumeFileImport, pendingFileImport])

  const selectTab = (id: string) => {
    if (id === activeTabId) return
    setActiveTabId(id)
    setResult(null)
    setError('')
    setLogs([])
    setFocusToken((token) => token + 1)
  }

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    if (activeTabId === id) setActiveTabId(next[Math.max(0, idx - 1)].id)
    setResult(null)
    setError('')
    setLogs([])
  }

  // ── backend ───────────────────────────────────────────────────────────────
  const api = async (path: string, body: unknown) => {
    const url = serverUrl(port, path)
    if (!url) throw new Error('Backend not ready')
    const res = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new Error(text.trim() || res.statusText)
    return text ? JSON.parse(text) : {}
  }

  const queryConnection = async (target: DbConnection) => {
    await saveQueue.current
    const current = connectionDrafts.current.find((c) => c.id === target.id) ?? target
    // Non-secret environment substitutions still work; opaque credentials stay in Go.
    return { connectionId: current.id, variables: vars }
  }

  const connectActive = async (disconnect = false) => {
    setRunning(true); setError('')
    try {
      await saveQueue.current
      const status = await api(disconnect ? '/database/disconnect' : '/database/connect', { connectionId: active.id, variables: vars })
      setStatuses((previous) => ({ ...previous, [active.id]: status }))
      if (!disconnect) { void refreshSchema(active); setMongoReload((n) => n + 1) }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setRunning(false) }
  }

  useEffect(() => {
    if (!hydrated || !port) return
    let cancelled = false
    const poll = async () => {
      const updates = await Promise.all(connections.map(async (c) => {
        try { return [c.id, await api('/database/status', { connectionId: c.id })] as const } catch { return null }
      }))
      if (!cancelled) setStatuses(Object.fromEntries(updates.filter((u) => u !== null)))
    }
    void poll()
    const stop = visibleInterval(() => void poll(), 3000, { scope: "database", kind: "live" })
    return () => { cancelled = true; stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, port, connections])

  /** How many rows/documents a write would touch, via a read-only count; null when it cannot be told safely. */
  const estimateImpact = async (kind: DbKind, text: string): Promise<number | null> => {
    const rewrite = countRewrite(kind, text)
    if (!rewrite) return null
    try {
      const data = await api('/database/query', { ...await queryConnection(active), query: rewrite, limit: 1, timeoutMs: Math.min(timeoutMs, 8000), explain: false, confirm: false }) as DbResult
      return extractCount(data)
    } catch { return null }
  }

  /** Plain-language reason for the confirmation, with the issues and the estimate when there is one. */
  const confirmationMessage = (interp: QueryInterpretation | null, estimate: number | null): string => {
    const unit = isMongo ? 'document' : 'row'
    const lines = [interp?.summary ?? 'This query changes data on the selected connection.']
    if (estimate !== null) lines.push(`It will affect ${estimate.toLocaleString()} ${unit}${estimate === 1 ? '' : 's'}.`)
    else if (interp?.writes && interp.issues.includes('no filter')) lines.push('There is no filter, so every record is affected.')
    const notes = (interp?.issues ?? []).filter((issue) => issue !== 'no filter')
    if (notes.length) lines.push(`Notes: ${notes.join('; ')}.`)
    lines.push('Continue?')
    return lines.join('\n')
  }

  /** Asks before a destructive run; false when the user declines. */
  const confirmRun = async (kind: DbKind | null, text: string, interp: QueryInterpretation | null, estimate = true): Promise<boolean> => {
    const count = estimate && kind ? await estimateImpact(kind, text) : null
    return confirm({
      title: isMongo || isRedis ? 'Confirm write operation' : 'Confirm dangerous query',
      message: confirmationMessage(interp, count),
      confirmLabel: 'Run query',
      variant: 'danger',
    })
  }

  const runQuery = async (explain = false, confirmed = false, analyze = false, override?: string) => {
    setError('')
    const connectionError = validateConnection(active)
    if (connectionError) { setError(connectionError); return }
    const source = override ?? query
    const text = override === undefined ? renderedQuery : substituteVars(override, vars)
    if (!text.trim()) { setError('Write a query before running it.'); return }
    if (isMongo || isRedis) {
      try { JSON.parse(text) } catch { setError(`${isRedis ? 'Redis' : 'MongoDB'} queries must be valid JSON.`); return }
    }
    const interp = override === undefined ? interpretation : queryKind ? interpret(queryKind, text, dbSchema.querySchema) : null
    const needsConfirm = override === undefined
      ? dangerous
      : interp?.risk === 'destructive' || (isRedis ? isDangerousRedis(text) : isMongo ? isDangerousMongo(text) : isDangerous(text))
    if (needsConfirm && !confirmed) {
      if (!await confirmRun(queryKind, text, interp)) return
      confirmed = true
    }
    setRunning(true)
    try {
      const data = await api('/database/query', { ...await queryConnection(active), query: text, limit, timeoutMs, explain, analyze, confirm: confirmed }) as DbResult
      setResult(data)
      const item = createHistoryRecord({ query: source, driver: active.driver, connectionId: active.id, name: activeTab?.name })
      const nextHistory = [item, ...history.filter((h) => h.query !== source)].slice(0, MAX_HISTORY)
      setHistory(nextHistory)
      await safeStoragePut(STORAGE_BUCKET, HISTORY_KEY, JSON.stringify(nextHistory))
      setLogs([
        `[${new Date().toLocaleTimeString()}] ${analyze ? 'EXPLAIN ANALYZE ' : explain ? 'EXPLAIN ' : ''}${data.statementType || 'query'} on ${data.driver}`,
        `→ ${data.columns?.length ? `${data.rows.length} rows` : `${data.rowsAffected} affected`} in ${data.durationMs} ms${data.limited ? ` (auto-limited to ${limit})` : ''}`,
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLogs([`[${new Date().toLocaleTimeString()}] error: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setRunning(false)
    }
  }

  /** Runs part of a SQL script: one statement/selection, or every statement in turn, stopping at the first error. */
  const runScript = async (scope: RunScope, text: string) => {
    if (scope !== 'all') { await runQuery(false, false, false, text); return }
    setError('')
    const connectionError = validateConnection(active)
    if (connectionError) { setError(connectionError); return }
    const statements = splitStatements(substituteVars(text, vars))
    if (!statements.length) { setError('Write a query before running it.'); return }
    const whole = queryKind ? interpret(queryKind, statements.join(';\n'), dbSchema.querySchema) : null
    // Same floor as runQuery: the interpreter, the legacy checks, and every driver (db2 has no interpreter).
    const needsConfirm = whole?.risk === 'destructive' || statements.some((statement) => isDangerous(statement))
    // `confirm` reaches the backend only when the user actually confirmed: the server-side gate stays armed otherwise.
    let confirmed = false
    if (needsConfirm) {
      if (!await confirmRun(queryKind, text, whole, false)) return
      confirmed = true
    }
    setRunning(true)
    const lines: string[] = []
    try {
      let last: DbResult | null = null
      for (let i = 0; i < statements.length; i += 1) {
        const label = `${i + 1}/${statements.length}`
        try {
          last = await api('/database/query', { ...await queryConnection(active), query: statements[i], limit, timeoutMs, explain: false, analyze: false, confirm: confirmed }) as DbResult
          lines.push(`[${label}] ${last.statementType || 'query'}: ${last.columns?.length ? `${last.rows.length} rows` : `${last.rowsAffected} affected`} in ${last.durationMs} ms`)
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          lines.push(`[${label}] error: ${reason}`)
          setError(`Statement ${label} failed: ${reason}`)
          break
        }
      }
      if (last) setResult(last)
      setLogs(lines)
    } finally {
      setRunning(false)
    }
  }

  /** Puts a console template in the editor, or in a new tab when the current one already has content. */
  const insertTemplate = (body: string, newTab: boolean) => {
    if (newTab || query.trim()) {
      const tab = blankTab(nextQueryName(tabs), '')
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
      setResult(null)
      setError('')
      setLogs([])
    }
    setSnippetRequest({ token: Date.now(), body })
  }

  const testConnection = async () => {
    setError('')
    const connectionError = validateConnection(active)
    if (connectionError) { setError(connectionError); return }
    setRunning(true)
    try {
      await saveQueue.current
      const data = await api('/database/test', { id: active.id }) as { driver: string; durationMs: number }
      setMessage(`Test passed: ${data.driver} in ${data.durationMs} ms`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const refreshSchema = async (target = active) => {
    const connectionError = validateConnection(target)
    if (connectionError) { setSchemaError(connectionError); setSchemaItems([]); return }
    const introspection = introspectionQuery(target.driver)
    if (!introspection) { setSchemaItems([]); return }
    setSchemaLoading(true)
    setSchemaError('')
    try {
      const runtimeConnection = await queryConnection(target)
      const data = await api('/database/query', { ...runtimeConnection, query: introspection, limit: 1000, timeoutMs, explain: false, confirm: false }) as DbResult
      const names = extractNames(data)
      const baseItems: SchemaItem[] = names.map((name) => ({ name, count: null }))
      setSchemaItems(baseItems)
      const colQuery = columnsQuery(target.driver)
      // Column names only feed editor completion: a failure here must not hide the table list.
      if (colQuery) {
        api('/database/query', { ...runtimeConnection, query: colQuery, limit: 20000, timeoutMs, explain: false, confirm: false })
          .then((r) => setSchemaColumns(extractColumns(r as DbResult)))
          .catch(() => setSchemaColumns({}))
      }
      setSchemaDb(target.database || (target.driver === 'sqlite' ? target.sqlitePath.split(/[\\/]/).pop() || 'SQLite' : DRIVER_META[target.driver].short))
      if (target.driver === 'redis') return
      const capped = names.slice(0, 30)
      const counts = await Promise.allSettled(
        capped.map((n) => api('/database/query', { ...runtimeConnection, query: countQuery(target.driver, n), limit: 1, timeoutMs, explain: false, confirm: false }) as Promise<DbResult>)
      )
      setSchemaItems(baseItems.map((item, idx) => {
        const r = counts[idx]
        return r && r.status === 'fulfilled' ? { ...item, count: extractCount(r.value) } : item
      }))
    } catch (e) {
      setSchemaItems([])
      setSchemaColumns({})
      setSchemaError(e instanceof Error ? e.message : String(e))
    } finally {
      setSchemaLoading(false)
    }
  }

  const runMongo = useCallback(async (command: Record<string, unknown>, options?: { confirm?: boolean }) => {
    const url = serverUrl(port, '/database/query')
    if (!url) throw new Error('Backend not ready')
    const res = await sidecarFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...await queryConnection(active), query: JSON.stringify(command), limit: 1000, timeoutMs, explain: false, confirm: options?.confirm ?? false }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(text.trim() || res.statusText)
    return JSON.parse(text) as DbResult
  }, [active, port, timeoutMs])
  runMongoRef.current = runMongo

  const createLocalSQLite = async () => {
    setError('')
    setRunning(true)
    try {
      const created = await api('/database/sqlite/create-local', { name: `adomnia-${active.id.slice(0, 8)}` }) as { path: string }
      const nextActive: DbConnection = {
        ...active,
        driver: 'sqlite',
        name: active.name.trim() && active.name !== 'Local SQLite' ? active.name : 'Local SQLite',
        port: 0,
        dsn: '',
        sqlitePath: created.path,
      }
      await persistConnections(connections.map((connection) => connection.id === active.id ? nextActive : connection))
      setMessage(`Local database ready: ${created.path}`)
      await refreshSchema(nextActive)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const createSchemaObject = async () => {
    setCreateObjectError('')
    let statement = ''
    try {
      statement = createObjectQuery(active.driver, createObjectName)
    } catch (e) {
      setCreateObjectError(e instanceof Error ? e.message : String(e))
      return
    }
    const connectionError = validateConnection(active)
    if (connectionError) { setCreateObjectError(connectionError); return }
    if (isRedis) {
      const ok = await confirm({ title: 'Create Redis key', message: `SET will create or overwrite ${createObjectName} with an empty value. Continue?`, confirmLabel: 'Create key', variant: 'danger' })
      if (!ok) return
    }
    setRunning(true)
    try {
      await api('/database/query', { ...await queryConnection(active), query: statement, limit: 1, timeoutMs, explain: false, confirm: isRedis })
      setCreateObjectOpen(false)
      setCreateObjectName('')
      setMessage(`${isRedis ? 'Key' : active.driver === 'mongodb' ? 'Collection' : 'Table'} created`)
      await refreshSchema(active)
    } catch (e) {
      setCreateObjectError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const formatQuery = () => {
    if (isMongo || isRedis) {
      try { setQuery(JSON.stringify(JSON.parse(query), null, 2)) } catch { /* leave invalid JSON untouched */ }
    } else {
      setQuery(query.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim())
    }
  }

  const persistSaved = (next: SavedQuery[]) => {
    setSaved(next)
    void safeStoragePut(STORAGE_BUCKET, SAVED_QUERIES_KEY, JSON.stringify(next))
  }

  const saveQuery = () => {
    if (!query.trim() || visibleSaved.some((q) => q.query === query && !q.personal)) { setMessage('Query already saved'); return }
    persistSaved(addSavedQuery(saved, createSavedQuery({ query, driver: active.driver, connectionId: active.id, name: activeTab?.name })))
    setMessage('Query saved to favorites')
  }

  const toggleFavorite = () => {
    const existing = visibleSaved.find((q) => q.query === query && !q.personal)
    if (existing) persistSaved(removeSavedQuery(saved, existing.id))
    else if (query.trim()) persistSaved(addSavedQuery(saved, createSavedQuery({ query, driver: active.driver, connectionId: active.id })))
  }

  const exportSaved = () => {
    download('adomnia-saved-queries.json', exportSavedQueries(saved), 'application/json')
    setMessage('Saved queries exported (secret-looking values redacted)')
  }

  const importSaved = (text: string) => {
    try {
      const incoming = importSavedQueries(text)
      persistSaved(mergeSavedQueries(saved, incoming))
      setMessage(`${incoming.length} saved ${incoming.length === 1 ? 'query' : 'queries'} imported`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const clearHistory = () => {
    setHistory([])
    void safeStoragePut(STORAGE_BUCKET, HISTORY_KEY, JSON.stringify([]))
  }

  const protectConnectionSecrets = async (passphrase: string) => {
    setError('')
    try {
      const protectedConnection = await protectDatabaseConnection(active, passphrase)
      await persistConnections(connections.map((connection) => connection.id === active.id ? protectedConnection : connection))
      setMessage(`${active.name} credentials replaced with encrypted Vault references`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  const exportJson = () => {
    if (!result) return
    // toEditable: i valori canonici Mongo ($numberInt, $date…) escono leggibili
    // ma tipizzati, senza perdere $oid e compagni (DB-1.10).
    const rows = result.rows.map((row) => toEditable(row))
    download('database-result.json', JSON.stringify({ columns: result.columns, rows, durationMs: result.durationMs }, null, 2), 'application/json')
  }

  const exportCsv = () => {
    if (!result) return
    const lines = [result.columns.map(csvEscape).join(','), ...result.rows.map((row) => result.columns.map((col) => csvEscape(row[col])).join(','))]
    download('database-result.csv', lines.join('\n'), 'text/csv')
  }

  const pickQuery = (value: string) => {
    setQuery(value)
    setResult(null)
    setError('')
    setLogs([])
    setFocusToken((token) => token + 1)
  }

  // ── render ──────────────────────────────────────────────────────────────
  const mongoModeSwitch = (
    <div role="tablist" aria-label="MongoDB mode" className="flex rounded-md border border-border-2 p-0.5">
      {([['documents', 'Explorer', <LayoutList key="i" size={12} />], ['raw', 'JSON runner', <Braces key="i" size={12} />]] as const).map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mongoView === id}
          onClick={() => setMongoView(id)}
          className={cn('flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium', mongoView === id ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:text-text-1')}
        >
          {icon} {label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-surface-0">
      <ConnectionsSidebar
        width={connectionsPane.size}
        connections={connections}
        active={active}
        running={running}
        onSelect={selectConnection}
        onAdd={addConnection}
        onDelete={deleteConnection}
        onUpdate={updateActive}
        onSetDriver={setDriver}
        onTest={testConnection}
        statuses={statuses}
        onConnect={() => void connectActive()}
        onDisconnect={() => void connectActive(true)}
        onVault={protectConnectionSecrets}
        onCreateLocalSQLite={() => void createLocalSQLite()}
      />
      <ResizeHandle label="Drag to resize connections" onMouseDown={connectionsPane.startResize} />

      {isMongo && mongoView === 'documents' ? (
        <MongoWorkspace connection={active} runMongo={runMongo} reloadToken={mongoReload} modeSwitch={mongoModeSwitch} />
      ) : (<>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isMongo && <div className="flex h-9 items-center justify-end border-b border-border-1 bg-surface-1 px-3">{mongoModeSwitch}</div>}
        <div className="flex min-h-0 flex-none" style={{ height: editorPane.size }}>
        {consoleOpen && (
          <QueryConsole
            driver={active.driver}
            targets={schemaItems.map((item) => item.name)}
            target={consoleTarget}
            onTarget={setConsoleTarget}
            columns={consoleColumns}
            database={isMongo ? active.database : ''}
            recent={history.map((h) => h.query)}
            saved={visibleSaved}
            currentQuery={query}
            onSaveCurrent={(name, personal) => {
              if (!query.trim()) return
              persistSaved(addSavedQuery(saved, createSavedQuery({ query, driver: active.driver, connectionId: personal ? null : active.id, name, personal })))
              setMessage(personal ? 'Saved as a personal template' : 'Query saved')
            }}
            onRenameSaved={(id, name) => persistSaved(renameSavedQuery(saved, id, name))}
            onRemoveSaved={(id) => persistSaved(removeSavedQuery(saved, id))}
            onTogglePersonal={(id, personal) => persistSaved(setPersonal(saved, id, personal))}
            onExportSaved={exportSaved}
            onImportSaved={importSaved}
            onInsert={insertTemplate}
            onRun={(text) => void runQuery(false, false, false, text)}
            onPickQuery={pickQuery}
            onClose={() => setConsoleOpen(false)}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col [&>*]:flex-1">
        {aiAvailable && aiOpen && queryKind && (
          <AiQueryAssistant
            driver={queryKind}
            provider={aiSettings.provider}
            currentQuery={query}
            schema={aiSchema}
            onInsert={(text) => { setQuery(text); setFocusToken((token) => token + 1) }}
            onClose={() => setAiOpen(false)}
          />
        )}
        <QueryEditor
          tabs={tabs}
          activeTabId={activeTabId}
          query={query}
          isMongo={isMongo}
          isRedis={isRedis}
          dangerous={dangerous}
          varsCount={Object.keys(vars).length}
          limit={limit}
          timeoutMs={timeoutMs}
          running={running}
          focusToken={focusToken}
          schema={completionSchema}
          onSelectTab={selectTab}
          onAddTab={addTab}
          onCloseTab={closeTab}
          onChangeQuery={setQuery}
          onSetLimit={setLimit}
          onSetTimeout={setTimeoutMs}
          onRun={(explain, analyze) => void runQuery(explain, false, analyze)}
          canAnalyze={active.driver === 'postgres' || active.driver === 'mysql'}
          onFormat={formatQuery}
          onSave={saveQuery}
          driver={queryKind ?? 'sqlite'}
          interpretation={interpretation}
          jsonContext={dbSchema.jsonContext}
          columnTypes={dbSchema.columnTypes}
          snippetRequest={snippetRequest}
          onSnippetApplied={() => setSnippetRequest(null)}
          consoleOpen={consoleOpen}
          onToggleConsole={() => setConsoleOpen((open) => !open)}
          aiAvailable={aiAvailable}
          aiOpen={aiOpen}
          onToggleAi={() => setAiOpen((open) => !open)}
          onRunScript={(scope, text) => void runScript(scope, text)}
        />
        </div>
        </div>
        <ResizeHandle orientation="horizontal" withLine={false} label="Drag to resize editor and results" onMouseDown={editorPane.startResize} />
        <ResultsView
          result={result}
          isMongo={isMongo}
          error={error}
          logs={logs}
          limit={limit}
          onExportJson={exportJson}
          onExportCsv={exportCsv}
          onRerun={() => void runQuery(false)}
        />
      </section>

      <ResizeHandle label="Drag to resize favorites, history and schema" onMouseDown={rightPane.startResize} />
      <RightRail
        width={rightPane.size}
        isMongo={isMongo}
        isRedis={isRedis}
        favorites={visibleSaved.filter((q) => !q.personal).map((q) => q.query)}
        history={history}
        schemaItems={schemaItems}
        schemaDb={schemaDb}
        schemaLoading={schemaLoading}
        schemaError={schemaError}
        schemaSearch={schemaSearch}
        schemaColumns={schemaColumns}
        queryTables={queryTables}
        currentQuery={query}
        onAddFavorite={toggleFavorite}
        onPickQuery={pickQuery}
        onClearHistory={clearHistory}
        onRefreshSchema={() => void refreshSchema()}
        onSchemaSearch={setSchemaSearch}
        onPickCollection={(name) => pickQuery(browseQuery(active.driver, name))}
        onCreateObject={() => { setCreateObjectName(''); setCreateObjectError(''); setCreateObjectOpen(true) }}
      />
      </>)}

      {createObjectOpen && (
        <div className="fixed inset-0 z-[260] grid place-items-center bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateObjectOpen(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="database-create-title" className="w-full max-w-sm rounded-md border border-border-2 bg-surface-2 shadow-2xl">
            <div className="flex h-11 items-center gap-2 border-b border-border-1 px-3.5">
              <Database size={14} className="text-accent" />
              <h3 id="database-create-title" className="text-[13px] font-semibold text-text-1">Create {isRedis ? 'key' : isMongo ? 'collection' : 'table'}</h3>
              <button onClick={() => setCreateObjectOpen(false)} className="ml-auto grid h-7 w-7 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1" aria-label="Close create database object dialog"><X size={14} /></button>
            </div>
            <div className="space-y-3 p-3.5">
              <label className="block text-[11px] font-medium text-text-2">
                Name
                <input
                  autoFocus
                  value={createObjectName}
                  onChange={(event) => { setCreateObjectName(event.target.value); setCreateObjectError('') }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void createSchemaObject(); if (event.key === 'Escape') setCreateObjectOpen(false) }}
                  placeholder={isMongo ? 'audit_events' : 'users'}
                  className="mt-1.5 h-8 w-full rounded-md border border-border-2 bg-surface-0 px-2.5 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                />
              </label>
              <p className="text-[10.5px] leading-4 text-text-4">A minimal {isRedis ? 'string key with an empty value' : isMongo ? 'collection' : 'table with a primary key'} will be created on the active connection.</p>
              {createObjectError && <div className="rounded border border-error/30 bg-error/10 px-2.5 py-2 text-[11px] text-error">{createObjectError}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border-1 px-3.5 py-3">
              <button onClick={() => setCreateObjectOpen(false)} className="h-8 rounded-md border border-border-2 px-3 text-[11.5px] text-text-2 hover:bg-surface-3">Cancel</button>
              <button onClick={() => void createSchemaObject()} disabled={running || !createObjectName.trim()} className="h-8 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* success toast */}
      {message && !error && (
        <div className="absolute bottom-4 left-[352px] z-40 flex items-center gap-2 rounded-lg border border-success/30 bg-surface-2 px-3.5 py-2 text-[11.5px] text-success shadow-xl">
          <CheckCircle2 size={14} /> {message}
        </div>
      )}
    </div>
  )
}
