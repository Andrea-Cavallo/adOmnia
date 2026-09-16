// BSON helpers for the MongoDB document view.
// The backend returns canonical Extended JSON ({"$oid"}, {"$numberInt"}, …) so
// field order and numeric types survive the trip to the UI and back.

export type BsonDoc = Record<string, unknown>

export type BsonKind =
  | 'ObjectId' | 'String' | 'Int32' | 'Int64' | 'Double' | 'Decimal128' | 'Boolean' | 'Date'
  | 'Null' | 'Object' | 'Array' | 'Binary' | 'Timestamp' | 'RegExp' | 'MinKey' | 'MaxKey' | 'Code' | 'Symbol'

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function onlyKey(v: Record<string, unknown>): string | null {
  const keys = Object.keys(v)
  return keys.length === 1 ? keys[0] : null
}

export function bsonKind(value: unknown): BsonKind {
  if (value === null || value === undefined) return 'Null'
  if (typeof value === 'string') return 'String'
  if (typeof value === 'boolean') return 'Boolean'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int32' : 'Double'
  if (Array.isArray(value)) return 'Array'
  if (!isPlainObject(value)) return 'String'
  const key = onlyKey(value)
  if (key === '$oid') return 'ObjectId'
  if (key === '$numberInt') return 'Int32'
  if (key === '$numberLong') return 'Int64'
  if (key === '$numberDouble') return 'Double'
  if (key === '$numberDecimal') return 'Decimal128'
  if (key === '$date') return 'Date'
  if (key === '$binary' || key === '$uuid') return 'Binary'
  if (key === '$timestamp') return 'Timestamp'
  if (key === '$regularExpression') return 'RegExp'
  if (key === '$minKey') return 'MinKey'
  if (key === '$maxKey') return 'MaxKey'
  if (key === '$symbol') return 'Symbol'
  if (key === '$code' || ('$code' in value && '$scope' in value)) return 'Code'
  return 'Object'
}

export const isContainer = (value: unknown): boolean => {
  const kind = bsonKind(value)
  return kind === 'Object' || kind === 'Array'
}

function dateMillis(value: unknown): number | null {
  if (!isPlainObject(value)) return null
  const raw = value.$date
  if (typeof raw === 'string') return Date.parse(raw)
  if (typeof raw === 'number') return raw
  if (isPlainObject(raw) && typeof raw.$numberLong === 'string') return Number(raw.$numberLong)
  return null
}

/** Short human display of a scalar BSON value (containers get a summary). */
export function bsonDisplay(value: unknown): string {
  const kind = bsonKind(value)
  const obj = isPlainObject(value) ? value : {}
  switch (kind) {
    case 'Null': return 'null'
    case 'String': return typeof value === 'string' ? value : String(value)
    case 'Boolean': return String(value)
    case 'ObjectId': return `ObjectId('${String(obj.$oid)}')`
    case 'Int32': return typeof value === 'number' ? String(value) : String(obj.$numberInt)
    case 'Int64': return String(obj.$numberLong)
    case 'Double': return typeof value === 'number' ? String(value) : String(obj.$numberDouble)
    case 'Decimal128': return String(obj.$numberDecimal)
    case 'Date': {
      const ms = dateMillis(value)
      return ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : JSON.stringify(obj.$date)
    }
    case 'Binary': {
      if (typeof obj.$uuid === 'string') return `UUID('${obj.$uuid}')`
      const bin = isPlainObject(obj.$binary) ? obj.$binary : {}
      return `Binary(subType ${String(bin.subType ?? '00')}, ${String(bin.base64 ?? '').length} b64 chars)`
    }
    case 'Timestamp': {
      const ts = isPlainObject(obj.$timestamp) ? obj.$timestamp : {}
      return `Timestamp(${String(ts.t)}, ${String(ts.i)})`
    }
    case 'RegExp': {
      const re = isPlainObject(obj.$regularExpression) ? obj.$regularExpression : {}
      return `/${String(re.pattern)}/${String(re.options ?? '')}`
    }
    case 'Array': return `Array (${(value as unknown[]).length})`
    case 'Object': return `Object (${Object.keys(obj).length} fields)`
    default: return JSON.stringify(value)
  }
}

/**
 * Canonical Extended JSON → a friendlier Extended JSON that the backend still
 * parses back to the same BSON types (relaxed parser):
 * - $numberInt → plain integer (parsed back as Int32 when it fits)
 * - non-integral $numberDouble → plain number (integral doubles keep the wrapper)
 * - $date → ISO-8601 string when representable
 * Everything else ($oid, $numberLong, $numberDecimal, $binary, …) stays explicit.
 */
export function toEditable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toEditable)
  if (!isPlainObject(value)) return value
  const key = onlyKey(value)
  if (key === '$numberInt') {
    const n = Number(value.$numberInt)
    return Number.isSafeInteger(n) ? n : value
  }
  if (key === '$numberDouble') {
    const n = Number(value.$numberDouble)
    return Number.isFinite(n) && !Number.isInteger(n) ? n : value
  }
  if (key === '$date') {
    const ms = dateMillis(value)
    // Relaxed $date strings only cover years 1970-9999.
    return ms != null && ms >= 0 && ms < 253402300800000 ? { $date: new Date(ms).toISOString() } : value
  }
  if (key && key.startsWith('$')) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = toEditable(v)
  return out
}

export const stringifyEditable = (doc: unknown): string => JSON.stringify(toEditable(doc), null, 2)

// ── shell syntax → Extended JSON ───────────────────────────────────────────
// Lets users type Compass/mongosh style filters:
//   { name: 'Ada', _id: ObjectId('…'), createdAt: { $gte: ISODate('2024-01-01') } }

const HELPERS: Record<string, (arg: string) => unknown> = {
  ObjectId: (arg) => ({ $oid: arg }),
  ISODate: (arg) => ({ $date: new Date(arg).toISOString() }),
  Date: (arg) => ({ $date: new Date(arg).toISOString() }),
  NumberLong: (arg) => ({ $numberLong: arg }),
  NumberInt: (arg) => ({ $numberInt: arg }),
  NumberDecimal: (arg) => ({ $numberDecimal: arg }),
  UUID: (arg) => ({ $uuid: arg }),
}

function readQuoted(src: string, start: number): { value: string; end: number } {
  const quote = src[start]
  let value = ''
  let i = start + 1
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\' && i + 1 < src.length) {
      value += JSON.parse(`"\\${src[i + 1] === "'" ? "u0027" : src[i + 1]}"`)
      i += 2
      continue
    }
    value += src[i]
    i += 1
  }
  if (i >= src.length) throw new Error('Unterminated string')
  return { value, end: i + 1 }
}

function shellToJson(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      const { value, end } = readQuoted(src, i)
      out += JSON.stringify(value)
      i = end
      continue
    }
    const ident = /^(?:new\s+)?([A-Za-z_$][\w$]*)/.exec(src.slice(i))
    if (ident && !/[\w$]/.test(src[i - 1] ?? '')) {
      const name = ident[1]
      let j = i + ident[0].length
      while (/\s/.test(src[j] ?? '')) j += 1
      if (src[j] === '(' && HELPERS[name]) {
        j += 1
        while (/\s/.test(src[j] ?? '')) j += 1
        let arg = ''
        if (src[j] === '"' || src[j] === "'") {
          const q = readQuoted(src, j)
          arg = q.value
          j = q.end
        } else {
          const num = /^[-\d.]+/.exec(src.slice(j))
          arg = num ? num[0] : ''
          j += arg.length
        }
        while (/\s/.test(src[j] ?? '')) j += 1
        if (src[j] !== ')') throw new Error(`${name}() is missing ")"`)
        if (name === 'ObjectId' && !/^[0-9a-f]{24}$/i.test(arg)) throw new Error('ObjectId needs a 24-character hex string')
        const helper = HELPERS[name](arg)
        out += JSON.stringify(helper)
        i = j + 1
        continue
      }
      if (src[j] === ':') {
        out += JSON.stringify(name)
        i += ident[0].length
        continue
      }
      out += ident[0]
      i += ident[0].length
      continue
    }
    out += ch
    i += 1
  }
  // Trailing commas are common when editing by hand.
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** Parses a query-bar field. Empty input → fallback. Throws with a readable message. */
export function parseShellDoc(input: string, label: string, fallback: BsonDoc | null = {}): BsonDoc | null {
  const text = input.trim()
  if (!text) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    try {
      parsed = JSON.parse(shellToJson(text))
    } catch (e) {
      throw new Error(`${label}: ${e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'invalid syntax'}`)
    }
  }
  if (!isPlainObject(parsed)) throw new Error(`${label} must be an object, e.g. { field: 'value' }`)
  return parsed
}

/** Parses a document typed in the editor (JSON or shell syntax); arrays allowed for bulk insert. */
export function parseEditorDocuments(input: string): BsonDoc[] {
  const text = input.trim()
  if (!text) throw new Error('Document is empty')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    try {
      parsed = JSON.parse(shellToJson(text))
    } catch (e) {
      throw new Error(e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON')
    }
  }
  const docs = Array.isArray(parsed) ? parsed : [parsed]
  if (!docs.length || !docs.every(isPlainObject)) throw new Error('Expected a document object or an array of documents')
  return docs
}

/** Top-level field names in first-seen order (for the table view). */
export function documentColumns(docs: BsonDoc[]): string[] {
  const seen = new Set<string>()
  for (const doc of docs) for (const key of Object.keys(doc)) seen.add(key)
  return [...seen]
}
