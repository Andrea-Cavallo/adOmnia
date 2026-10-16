// One derived view of the loaded schema for everything that reads it: the editor completion
// (SQL and JSON), the query interpreter and the console (FIX.md DB-3.1.5).
// Mongo fields are sampled lazily, one collection at a time, only when the connection is
// live and a query actually names that collection: never on connect, never in the background.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DbResult, SchemaColumn, SchemaItem } from './dbShared'
import type { SqlColumnTypes, SqlSchema } from './sqlComplete'
import type { QuerySchema } from './queryInterpreter'
import type { JsonCompleteContext } from './jsonComplete'
import { analyzeSchema } from './mongo/schema'
import type { BsonDoc } from './mongo/bson'

const SAMPLE_SIZE = 50
const MAX_SAMPLED_FIELDS = 200

import type { RunMongo } from './mongo/useMongoBrowser'

interface UseDbSchemaArgs {
  driver: string
  connectionId: string
  /** True while the backend reports a live connection: sampling never opens one. */
  connected: boolean
  schemaItems: SchemaItem[]
  schemaColumns: Record<string, SchemaColumn[]>
  runMongo: RunMongo
}

export interface DbSchemaView {
  /** table → columns for SQL completion (empty for Mongo/Redis). */
  completionSchema: SqlSchema
  columnTypes: SqlColumnTypes
  /** Shape the interpreter reads for "unknown column/table" checks. */
  querySchema: QuerySchema
  jsonContext: JsonCompleteContext | null
  /** Samples fields of a Mongo collection once; no-op for other drivers or without a live connection. */
  ensureSample: (collection: string) => void
}

/**
 * Indexed field names out of a `listIndexes` result (DB-3.1.5). Both response
 * shapes are accepted: index documents or rows carrying a `key` spec.
 */
export function mongoIndexFields(result: DbResult): string[] {
  const entries = ((result.documents ?? result.rows ?? []) as Array<Record<string, unknown>>)
  const fields = new Set<string>()
  for (const entry of entries) {
    const key = entry?.key
    if (key && typeof key === 'object' && !Array.isArray(key)) {
      for (const name of Object.keys(key as Record<string, unknown>)) fields.add(name)
    }
  }
  return [...fields]
}

export function useDbSchema({ driver, connectionId, connected, schemaItems, schemaColumns, runMongo }: UseDbSchemaArgs): DbSchemaView {
  const [samples, setSamples] = useState<Record<string, string[]>>({})
  const [indexes, setIndexes] = useState<Record<string, string[]>>({})
  const inflight = useRef(new Set<string>())
  const runMongoRef = useRef(runMongo)
  runMongoRef.current = runMongo

  // Bumped on every reset: a sample that was already in flight for the previous connection or schema must not land in the new one.
  const generation = useRef(0)

  // A refresh (new item list) or another connection drops what was sampled.
  useEffect(() => {
    generation.current += 1
    setSamples({})
    setIndexes({})
    inflight.current = new Set()
  }, [connectionId, schemaItems])

  const isMongo = driver === 'mongodb'
  const isRedis = driver === 'redis'

  const completionSchema = useMemo<SqlSchema>(
    () => (isMongo || isRedis ? {} : Object.fromEntries(schemaItems.map((t) => [t.name, (schemaColumns[t.name] ?? []).map((c) => c.name)]))),
    [isMongo, isRedis, schemaItems, schemaColumns],
  )

  const columnTypes = useMemo<SqlColumnTypes>(
    () => Object.fromEntries(Object.entries(schemaColumns).map(([table, cols]) => [table, Object.fromEntries(cols.map((c) => [c.name, c.type]))])),
    [schemaColumns],
  )

  const querySchema = useMemo<QuerySchema>(() => {
    if (isRedis) return {}
    if (isMongo) return { collections: schemaItems.map((t) => ({ name: t.name, columns: samples[t.name], indexes: indexes[t.name] })) }
    return { tables: schemaItems.map((t) => ({ name: t.name, columns: schemaColumns[t.name]?.map((c) => c.name) })) }
  }, [isMongo, isRedis, schemaItems, schemaColumns, samples, indexes])

  const jsonContext = useMemo<JsonCompleteContext | null>(
    () => (isMongo || isRedis ? { driver: isRedis ? 'redis' : 'mongodb', collections: schemaItems.map((t) => t.name), fields: samples } : null),
    [isMongo, isRedis, schemaItems, samples],
  )

  const ensureSample = useCallback((collection: string) => {
    if (!isMongo || !connected || !collection || samples[collection] || inflight.current.has(collection)) return
    const startedAt = generation.current
    const pending = inflight.current
    pending.add(collection)
    runMongoRef.current({ operation: 'find', collection, limit: SAMPLE_SIZE, canonical: true })
      .then((result) => {
        if (generation.current !== startedAt) return
        const fields = analyzeSchema((result.documents ?? []) as BsonDoc[]).map((f) => f.path).slice(0, MAX_SAMPLED_FIELDS)
        setSamples((current) => ({ ...current, [collection]: fields }))
      })
      .catch(() => undefined) // completion is best-effort: a failed sample must never surface as an error
      .finally(() => pending.delete(collection))
    // Indexes feed the "unindexed field" warning only (DB-3.1.5); best-effort like the sample.
    runMongoRef.current({ operation: 'runCommand', command: { listIndexes: collection } })
      .then((result) => {
        if (generation.current !== startedAt) return
        setIndexes((current) => ({ ...current, [collection]: mongoIndexFields(result) }))
      })
      .catch(() => undefined)
  }, [isMongo, connected, samples])

  return { completionSchema, columnTypes, querySchema, jsonContext, ensureSample }
}
