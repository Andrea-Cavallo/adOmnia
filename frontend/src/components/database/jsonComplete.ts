// Context-aware completion for the Mongo / Redis JSON runner (FIX.md DB-3.1.4).
// Pure: given the text, the caret and what the schema knows, returns what to suggest.
// Invalid or half-typed JSON never throws: the scan simply stops at the caret.

import type { SqlCompletion, SqlCompletionItem } from './sqlComplete'
import { STAGE_OPERATORS } from './mongo/AggregationsTab'

export interface JsonCompleteContext {
  driver: 'mongodb' | 'redis'
  collections: string[]
  /** collection → known field names (sampled or from the schema). */
  fields: Record<string, string[]>
}

export const MONGO_OPERATION_NAMES = [
  'find', 'aggregate', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
  'count', 'countDocuments', 'estimatedCount', 'listCollections', 'listDatabases', 'createCollection', 'dropCollection',
  'dropDatabase', 'runCommand',
]
export const REDIS_COMMAND_NAMES = [
  'GET', 'SET', 'DEL', 'EXPIRE', 'TTL', 'EXISTS', 'TYPE', 'INCR', 'DECR', 'MGET', 'MSET', 'HGET', 'HGETALL', 'HSET', 'HDEL',
  'LPUSH', 'RPUSH', 'LRANGE', 'LLEN', 'SADD', 'SMEMBERS', 'SREM', 'ZADD', 'ZRANGE', 'DBSIZE', 'INFO', 'PING',
]
const MONGO_TOP_KEYS = [
  'operation', 'database', 'collection', 'filter', 'projection', 'sort', 'pipeline', 'document', 'documents',
  'update', 'command', 'limit', 'skip', 'upsert',
]
const REDIS_TOP_KEYS = ['command', 'args', 'operation', 'pattern', 'key']
const FILTER_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex', '$and', '$or', '$nor', '$not', '$size', '$all', '$elemMatch', '$type',
]
const UPDATE_OPERATORS = ['$set', '$unset', '$inc', '$push', '$pull', '$addToSet', '$pop', '$rename', '$min', '$max', '$mul', '$currentDate', '$setOnInsert']
const MAX_ITEMS = 50

interface Frame {
  kind: 'obj' | 'arr'
  key: string | null
  expectingKey: boolean
}

interface Scan {
  frames: Frame[]
  inString: boolean
  /** True when the open string is an object key. */
  stringIsKey: boolean
  /** Text of the open string up to the caret (raw, escapes not decoded). */
  stringText: string
}

function scanToCaret(text: string, caret: number): Scan {
  const frames: Frame[] = []
  let inString = false
  let stringIsKey = false
  let stringText = ''
  for (let i = 0; i < caret; i += 1) {
    const c = text[i]
    const top = frames[frames.length - 1]
    if (inString) {
      if (c === '\\') { stringText += c + (text[i + 1] ?? ''); i += 1; continue }
      if (c === '"') {
        inString = false
        if (stringIsKey && top) top.key = stringText
        else if (top && top.kind === 'obj') top.expectingKey = false
        continue
      }
      stringText += c
      continue
    }
    if (c === '"') { inString = true; stringText = ''; stringIsKey = !!top && top.kind === 'obj' && top.expectingKey; continue }
    if (c === '{') { frames.push({ kind: 'obj', key: null, expectingKey: true }); continue }
    if (c === '[') { frames.push({ kind: 'arr', key: null, expectingKey: false }); continue }
    if (c === '}' || c === ']') { frames.pop(); const parent = frames[frames.length - 1]; if (parent?.kind === 'obj') parent.expectingKey = false; continue }
    if (c === ':' && top?.kind === 'obj') { top.expectingKey = false; continue }
    if (c === ',' && top?.kind === 'obj') { top.expectingKey = true; top.key = null }
  }
  return { frames, inString, stringIsKey, stringText }
}

/** Keys of the enclosing objects from the root down, arrays shown as `[]`. */
function pathOf(frames: Frame[]): string[] {
  const path: string[] = []
  frames.forEach((frame, index) => {
    if (index === frames.length - 1) return
    path.push(frame.kind === 'arr' ? '[]' : frame.key ?? '')
  })
  return path
}

function rootCollection(text: string): string {
  const match = /"collection"\s*:\s*"([^"]*)"/.exec(text)
  return match ? match[1] : ''
}

function rank(labels: readonly string[], kind: SqlCompletionItem['kind'], prefix: string, detail?: string): SqlCompletionItem[] {
  const p = prefix.toLowerCase()
  const starts: SqlCompletionItem[] = []
  const contains: SqlCompletionItem[] = []
  for (const label of labels) {
    const l = label.toLowerCase()
    if (l === p) continue
    if (l.startsWith(p)) starts.push({ label, kind, detail })
    else if (p && l.includes(p)) contains.push({ label, kind, detail })
  }
  return [...starts, ...contains]
}

export function jsonCompletions(text: string, caret: number, ctx: JsonCompleteContext, explicit = false): SqlCompletion | null {
  const scan = scanToCaret(text, caret)
  const top = scan.frames[scan.frames.length - 1]
  if (!top || top.kind !== 'obj') return null

  let prefix = scan.stringText
  let start = caret - prefix.length
  let quote = false
  if (!scan.inString) {
    // Outside a string only a key position can be completed, and it needs a typed word or Ctrl+Space.
    const word = /[A-Za-z_$][\w$]*$/.exec(text.slice(0, caret))?.[0] ?? ''
    if (!top.expectingKey || (!word && !explicit)) return null
    prefix = word
    start = caret - word.length
    quote = true
  }

  const path = pathOf(scan.frames)
  const items: SqlCompletionItem[] = []
  const depth = path.length
  const root = path[0] ?? ''
  const isKey = scan.inString ? scan.stringIsKey : true
  const collection = rootCollection(text)
  const knownFields = ctx.fields[collection] ?? []

  if (isKey) {
    if (depth === 0) {
      items.push(...rank(ctx.driver === 'redis' ? REDIS_TOP_KEYS : MONGO_TOP_KEYS, 'keyword', prefix))
    } else if (ctx.driver === 'mongodb') {
      const parent = path[path.length - 1]
      if (prefix.startsWith('$')) {
        if (root === 'pipeline' && depth <= 2) items.push(...rank(STAGE_OPERATORS, 'keyword', prefix))
        else if (root === 'update' && depth === 1) items.push(...rank(UPDATE_OPERATORS, 'keyword', prefix))
        else items.push(...rank(FILTER_OPERATORS, 'keyword', prefix))
      } else if (root === 'update' && depth === 1) {
        items.push(...rank(UPDATE_OPERATORS, 'keyword', prefix))
      } else if (['filter', 'projection', 'sort', 'update', 'document'].includes(root) || (root === 'pipeline' && parent !== '[]')) {
        // Field names, not operators, after an operator key such as $set / $match.
        items.push(...rank(knownFields, 'column', prefix, collection || undefined))
      } else if (root === 'documents') {
        items.push(...rank(knownFields, 'column', prefix, collection || undefined))
      }
    }
  } else if (depth === 0) {
    const key = top.key ?? ''
    if (key === 'operation') {
      items.push(...rank(ctx.driver === 'redis' ? ['scan', 'inspect'] : MONGO_OPERATION_NAMES, 'keyword', prefix))
    } else if (key === 'collection' && ctx.driver === 'mongodb') {
      items.push(...rank(ctx.collections, 'table', prefix))
    } else if (key === 'command' && ctx.driver === 'redis') {
      items.push(...rank(REDIS_COMMAND_NAMES, 'keyword', prefix))
    }
  }

  const final = items.slice(0, MAX_ITEMS).map((item) => (quote ? { ...item, insert: `"${item.label}"` } : item))
  if (!final.length) return null
  return {
    start,
    prefix,
    items: final.map((item) => ({ label: (item as { insert?: string }).insert ?? item.label, kind: item.kind, detail: item.detail })),
  }
}
