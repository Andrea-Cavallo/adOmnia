import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbConnection, DbResult } from '../dbShared'
import { extractCount, extractNames } from '../dbShared'
import { parseEditorDocuments, parseShellDoc, type BsonDoc } from './bson'
import type { MongoDbNode } from './MongoNavigator'
import { EMPTY_MONGO_QUERY, type MongoQueryState } from './MongoQueryBar'

export type RunMongo = (command: Record<string, unknown>, options?: { confirm?: boolean }) => Promise<DbResult>

const COUNT_CAP = 50
const IMPORT_BATCH = 1000
const EXPORT_CAP = 100_000

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export interface FindSpec {
  filter: BsonDoc
  projection: BsonDoc | null
  sort: BsonDoc | null
  skip: number
  limit: number
}

/** Parses the query bar into driver arguments; throws a readable error. */
export function findSpec(state: MongoQueryState): FindSpec {
  return {
    filter: parseShellDoc(state.filter, 'Filter') ?? {},
    projection: parseShellDoc(state.project, 'Project', null),
    sort: parseShellDoc(state.sort, 'Sort', null),
    skip: Number(state.skip) || 0,
    limit: Math.min(1000, Math.max(1, Number(state.limit) || 20)),
  }
}

/** Data layer for the Compass-style browser: database tree, paged find, document CRUD. */
export function useMongoBrowser(connection: DbConnection, runMongo: RunMongo, reloadToken: number) {
  const [databases, setDatabases] = useState<MongoDbNode[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState('')
  const [selected, setSelected] = useState<{ db: string; collection: string } | null>(null)
  const [query, setQuery] = useState<MongoQueryState>(EMPTY_MONGO_QUERY)
  const [page, setPage] = useState(0)
  const [docs, setDocs] = useState<BsonDoc[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const findSeq = useRef(0)

  const patchDb = (name: string, patch: Partial<MongoDbNode>) =>
    setDatabases((prev) => prev.map((db) => (db.name === name ? { ...db, ...patch } : db)))

  const patchCount = (db: string, collection: string, delta: number) =>
    setDatabases((prev) => prev.map((node) => node.name !== db || !node.collections ? node : {
      ...node,
      collections: node.collections.map((c) => c.name === collection && c.count != null ? { ...c, count: Math.max(0, c.count + delta) } : c),
    }))

  const loadCollections = useCallback(async (db: string) => {
    patchDb(db, { loading: true, error: '' })
    try {
      const names = extractNames(await runMongo({ operation: 'listCollections', database: db })).sort((a, b) => a.localeCompare(b))
      patchDb(db, { collections: names.map((name) => ({ name, count: null })), loading: false })
      // ponytail: estimated counts for the first 50 collections only; lazy per-row counts if huge DBs need them.
      const counts = await Promise.allSettled(names.slice(0, COUNT_CAP).map((name) => runMongo({ operation: 'estimatedCount', database: db, collection: name })))
      setDatabases((prev) => prev.map((node) => node.name !== db ? node : {
        ...node,
        collections: names.map((name, i) => {
          const r = counts[i]
          return { name, count: r && r.status === 'fulfilled' ? extractCount(r.value) : null }
        }),
      }))
    } catch (e) {
      patchDb(db, { loading: false, error: errorText(e) })
    }
  }, [runMongo])

  const find = useCallback(async (target = selected, state = query, pageIndex = page) => {
    if (!target) return
    let spec: FindSpec
    try {
      spec = findSpec(state)
    } catch (e) {
      setError(errorText(e))
      return
    }
    const { filter, projection: project, sort, limit, skip: baseSkip } = spec
    const seq = ++findSeq.current
    const scope = { database: target.db, collection: target.collection }
    setLoading(true)
    setError('')
    const empty = Object.keys(filter).length === 0
    const countPromise = runMongo(empty ? { operation: 'estimatedCount', ...scope } : { operation: 'count', ...scope, filter })
      .then(extractCount)
      .catch(() => null)
    try {
      const result = await runMongo({
        operation: 'find', ...scope, filter,
        ...(project ? { projection: project } : {}),
        ...(sort ? { sort } : {}),
        skip: baseSkip + pageIndex * limit, limit, canonical: true,
      })
      if (seq !== findSeq.current) return
      setDocs(result.documents ?? [])
      setDurationMs(result.durationMs)
      const count = await countPromise
      if (seq === findSeq.current) setTotal(count == null ? null : Math.max(0, count - baseSkip))
    } catch (e) {
      if (seq === findSeq.current) { setDocs([]); setTotal(null); setError(errorText(e)) }
    } finally {
      if (seq === findSeq.current) setLoading(false)
    }
  }, [page, query, runMongo, selected])

  const refreshDatabases = useCallback(async () => {
    setTreeLoading(true)
    setTreeError('')
    const preferred = connection.database.trim()
    let names: string[] = []
    try {
      names = extractNames(await runMongo({ operation: 'listDatabases' }))
    } catch (e) {
      // Users scoped to one database often lack the listDatabases privilege.
      if (!preferred) { setTreeError(errorText(e)); setTreeLoading(false); return }
    }
    if (preferred && !names.includes(preferred)) names = [preferred, ...names]
    setDatabases(names.map((name) => ({ name, collections: null, loading: false, error: '' })))
    setTreeLoading(false)
    const initial = preferred || names.find((n) => !['admin', 'config', 'local'].includes(n)) || names[0]
    if (initial) {
      setExpanded([initial])
      void loadCollections(initial)
      if (preferred && connection.collection.trim()) {
        const target = { db: preferred, collection: connection.collection.trim() }
        setSelected(target)
        void find(target, EMPTY_MONGO_QUERY, 0)
      }
    }
  }, [connection.collection, connection.database, find, loadCollections, runMongo])

  // Reload the tree on connection switch or after a successful connection test.
  useEffect(() => {
    findSeq.current += 1
    setDatabases([]); setExpanded([]); setSelected(null); setDocs([]); setTotal(null); setError(''); setLoading(false)
    void refreshDatabases()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, reloadToken])

  const toggleDb = (db: string) => {
    const open = expanded.includes(db)
    setExpanded(open ? expanded.filter((d) => d !== db) : [...expanded, db])
    if (!open && !databases.find((d) => d.name === db)?.collections) void loadCollections(db)
  }

  const selectCollection = (db: string, collection: string) => {
    const next = { db, collection }
    setSelected(next)
    setQuery(EMPTY_MONGO_QUERY)
    setPage(0)
    void find(next, EMPTY_MONGO_QUERY, 0)
  }

  const runFind = () => { setPage(0); void find(selected, query, 0) }
  const resetQuery = () => { setQuery(EMPTY_MONGO_QUERY); setPage(0); void find(selected, EMPTY_MONGO_QUERY, 0) }
  const goToPage = (index: number) => { setPage(index); void find(selected, query, index) }

  const mutate = async (command: Record<string, unknown>, countDelta = 0) => {
    if (!selected) throw new Error('Select a collection first')
    setBusy(true)
    try {
      await runMongo({ ...command, database: selected.db, collection: selected.collection })
      if (countDelta) patchCount(selected.db, selected.collection, countDelta)
      await find()
    } finally {
      setBusy(false)
    }
  }

  const replaceDocument = async (original: BsonDoc, text: string) => {
    if (!('_id' in original)) throw new Error('Documents without _id cannot be edited safely')
    const [next] = parseEditorDocuments(text)
    await mutate({ operation: 'replaceOne', filter: { _id: original._id }, document: next })
  }

  const deleteDocument = async (original: BsonDoc) => {
    if (!('_id' in original)) throw new Error('Documents without _id cannot be deleted safely')
    await mutate({ operation: 'deleteOne', filter: { _id: original._id } }, -1)
  }

  const insertDocuments = async (text: string) => {
    const parsed = parseEditorDocuments(text)
    await mutate(parsed.length === 1
      ? { operation: 'insertOne', document: parsed[0] }
      : { operation: 'insertMany', documents: parsed }, parsed.length)
  }

  const importDocuments = async (docs: BsonDoc[], onProgress: (done: number) => void) => {
    if (!selected) throw new Error('Select a collection first')
    setBusy(true)
    let done = 0
    try {
      for (let i = 0; i < docs.length; i += IMPORT_BATCH) {
        const batch = docs.slice(i, i + IMPORT_BATCH)
        await runMongo({ operation: 'insertMany', database: selected.db, collection: selected.collection, documents: batch })
        done += batch.length
        onProgress(done)
      }
    } finally {
      if (done) patchCount(selected.db, selected.collection, done)
      setBusy(false)
      void find()
    }
    return done
  }

  /** Reads every document matching the current filter/sort (capped) for export. */
  const exportDocuments = async (onProgress: (done: number) => void) => {
    if (!selected) throw new Error('Select a collection first')
    const { filter, projection, sort } = findSpec(query)
    const all: BsonDoc[] = []
    // ponytail: skip-based paging, fine up to the 100k cap; switch to _id range paging for bigger exports.
    while (all.length < EXPORT_CAP) {
      const r = await runMongo({
        operation: 'find', database: selected.db, collection: selected.collection, filter,
        ...(projection ? { projection } : {}), ...(sort ? { sort } : { sort: { _id: 1 } }),
        skip: all.length, limit: IMPORT_BATCH, canonical: true,
      })
      const page = (r.documents ?? []) as BsonDoc[]
      all.push(...page)
      onProgress(all.length)
      if (page.length < IMPORT_BATCH) break
    }
    return all
  }

  const dropCollection = async (db: string, name: string) => {
    await runMongo({ operation: 'dropCollection', database: db, collection: name }, { confirm: true })
    if (selected?.db === db && selected.collection === name) { setSelected(null); setDocs([]); setTotal(null) }
    await loadCollections(db)
  }

  const createCollection = async (db: string, name: string) => {
    await runMongo({ operation: 'createCollection', database: db, collection: name })
    await loadCollections(db)
    selectCollection(db, name)
  }

  return {
    databases, expanded, treeLoading, treeError, selected,
    query, setQuery, page, docs, total, loading, busy, error, durationMs,
    refreshDatabases, toggleDb, selectCollection, runFind, resetQuery, goToPage,
    replaceDocument, deleteDocument, insertDocuments, importDocuments, exportDocuments,
    createCollection, dropCollection,
  }
}
