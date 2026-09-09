import { canonicalKey, flattenPayload } from './normalize'
import type { LogEvent } from './types'

/**
 * Field discovery: after an import, work out which keys this log actually uses
 * — including the ones nobody modelled — so a custom application format becomes
 * searchable and filterable without any configuration.
 */

export type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

export interface FieldValue {
  value: string
  count: number
}

export interface DiscoveredField {
  /** Dotted path as written in the payload, e.g. `attributes.http.status_code`. */
  path: string
  canonical: string
  /** Events (in the sample) carrying the key. */
  count: number
  /** count / sampled, 0..1. */
  coverage: number
  kinds: FieldKind[]
  /** Most frequent values, empty when the field has too many distinct ones. */
  values: FieldValue[]
  /** Distinct scalar values seen, or -1 once the cardinality cap was passed. */
  distinct: number
}

export interface FieldDiscovery {
  fields: DiscoveredField[]
  /** Events actually inspected (JSON ones, after striding). */
  sampled: number
  total: number
  /** Canonical top-level keys present in most events. */
  signature: string[]
  /** Identifies "this kind of log", so a schema can be recalled later. */
  fingerprint: string
}

export const EMPTY_DISCOVERY: FieldDiscovery = {
  fields: [], sampled: 0, total: 0, signature: [], fingerprint: '',
}

// Above this many distinct values a field is an identifier, not a facet: stop
// collecting values and just report the count.
const DISTINCT_CAP = 40
const VALUES_SHOWN = 8
const DEFAULT_SAMPLE = 3000
const MAX_VALUE_LENGTH = 120

function kindOf(value: unknown): FieldKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

interface Accumulator {
  path: string
  count: number
  kinds: Set<FieldKind>
  values: Map<string, number>
  overflow: boolean
}

/**
 * Scan a batch and report every key it contains. Large batches are strided
 * rather than fully scanned: the shape of a log is visible from a sample, and
 * this runs on the main thread right after an import.
 */
export function discoverFields(events: LogEvent[], options: { sampleSize?: number } = {}): FieldDiscovery {
  const total = events.length
  if (total === 0) return EMPTY_DISCOVERY

  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE
  const stride = total > sampleSize ? Math.ceil(total / sampleSize) : 1
  const stats = new Map<string, Accumulator>()
  let sampled = 0

  for (let i = 0; i < total; i += stride) {
    const payload = events[i].json
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    sampled++

    for (const [path, value] of Object.entries(flattenPayload(payload as Record<string, unknown>))) {
      let entry = stats.get(path)
      if (!entry) {
        entry = { path, count: 0, kinds: new Set(), values: new Map(), overflow: false }
        stats.set(path, entry)
      }
      entry.count++
      entry.kinds.add(kindOf(value))

      if (entry.overflow || value === null || typeof value === 'object') continue
      const text = String(value)
      if (text.length > MAX_VALUE_LENGTH) continue
      const seen = entry.values.get(text)
      if (seen === undefined && entry.values.size >= DISTINCT_CAP) {
        entry.overflow = true
        entry.values.clear()
        continue
      }
      entry.values.set(text, (seen ?? 0) + 1)
    }
  }

  if (sampled === 0) return { ...EMPTY_DISCOVERY, total }

  const fields: DiscoveredField[] = [...stats.values()]
    .map((entry) => ({
      path: entry.path,
      canonical: canonicalKey(entry.path),
      count: entry.count,
      coverage: entry.count / sampled,
      kinds: [...entry.kinds].sort(),
      distinct: entry.overflow ? -1 : entry.values.size,
      values: entry.overflow
        ? []
        : [...entry.values.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
          .slice(0, VALUES_SHOWN),
    }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))

  const signature = signatureOf(fields)
  return { fields, sampled, total, signature, fingerprint: signature.length ? hash(signature.join(',')) : '' }
}

/**
 * The canonical top-level keys present in most events — the shape of the log,
 * ignoring the optional fields that come and go.
 */
export function signatureOf(fields: DiscoveredField[]): string[] {
  return fields
    .filter((field) => !field.path.includes('.') && field.coverage >= 0.5)
    .map((field) => field.canonical)
    .sort()
}

/** Overlap of two signatures, 0..1. */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const left = new Set(a)
  let shared = 0
  for (const key of new Set(b)) if (left.has(key)) shared++
  return shared / (left.size + new Set(b).size - shared)
}

/** FNV-1a, base36. Enough to key a local cache; not a security hash. */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(36)
}

// ─── Remembering a schema across sessions ────────────────────────────────────

const STORE_KEY = 'adomnia.loginspector.schemas'
const MAX_SCHEMAS = 20

// A log gains and loses fields between releases, so a schema is recalled by
// resemblance rather than by an exact key set.
const MATCH_THRESHOLD = 0.6

export interface StoredSchema {
  fingerprint: string
  /** Name of the source it was first seen in, for the UI. */
  name: string
  updatedAt: number
  /** How many imports matched this shape. */
  seen: number
  /** Canonical top-level keys, used to recognize the shape again. */
  keys: string[]
  /** Union of every path ever discovered for this shape. */
  paths: string[]
}

export function loadSchemas(): Record<string, StoredSchema> {
  try {
    const stored = localStorage.getItem(STORE_KEY)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredSchema>) : {}
  } catch {
    return {}
  }
}

function persist(schemas: Record<string, StoredSchema>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(schemas))
  } catch {
    /* private mode or quota — remembering schemas is a convenience, not state */
  }
}

/**
 * Merge a discovery into the stored schema for its fingerprint, so a field seen
 * in an earlier import stays known even when this one does not contain it.
 * Returns the stored entry, or null when the batch had no JSON to learn from.
 */
export function rememberSchema(discovery: FieldDiscovery, sourceName: string): StoredSchema | null {
  if (!discovery.fingerprint || discovery.fields.length === 0) return null

  const schemas = loadSchemas()
  const previous = findMatch(schemas, discovery.signature)

  const paths = new Set(previous?.paths ?? [])
  for (const field of discovery.fields) paths.add(field.path)
  const keys = new Set(previous?.keys ?? [])
  for (const key of discovery.signature) keys.add(key)

  const entry: StoredSchema = {
    fingerprint: previous?.fingerprint ?? discovery.fingerprint,
    name: previous?.name || sourceName || 'Unnamed log',
    updatedAt: Date.now(),
    seen: (previous?.seen ?? 0) + 1,
    keys: [...keys].sort(),
    paths: [...paths].sort(),
  }

  const merged = { ...schemas, [entry.fingerprint]: entry }
  const ordered = Object.values(merged).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SCHEMAS)
  persist(Object.fromEntries(ordered.map((schema) => [schema.fingerprint, schema])))
  return entry
}

/** The stored schema this shape resembles most, if any is close enough. */
function findMatch(schemas: Record<string, StoredSchema>, signature: string[]): StoredSchema | undefined {
  let best: StoredSchema | undefined
  let bestScore = 0
  for (const schema of Object.values(schemas)) {
    const score = similarity(signature, schema.keys ?? [])
    if (score > bestScore) {
      bestScore = score
      best = schema
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : undefined
}

export function forgetSchema(fingerprint: string): void {
  const schemas = loadSchemas()
  delete schemas[fingerprint]
  persist(schemas)
}

/**
 * Paths remembered for a shape, including ones absent from the current batch.
 * Matched by resemblance, like `rememberSchema`, so a log that gained a field
 * still finds its history.
 */
export function rememberedPaths(signature: string[]): string[] {
  return findMatch(loadSchemas(), signature)?.paths ?? []
}
