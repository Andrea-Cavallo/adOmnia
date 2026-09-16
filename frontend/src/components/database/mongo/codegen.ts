// Export a Documents query or an aggregation pipeline as driver code.
import { bsonDisplay, bsonKind, type BsonDoc } from './bson'

export type CodeLanguage = 'node' | 'python' | 'go' | 'java' | 'shell'

export const CODE_LANGUAGES: { id: CodeLanguage; label: string }[] = [
  { id: 'shell', label: 'mongosh' },
  { id: 'node', label: 'Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
]

export type CodeRequest =
  | { kind: 'find'; db: string; collection: string; filter: BsonDoc; projection?: BsonDoc | null; sort?: BsonDoc | null; skip?: number; limit?: number }
  | { kind: 'aggregate'; db: string; collection: string; pipeline: BsonDoc[] }

const q = (s: string) => JSON.stringify(s)
const pad = (depth: number) => '  '.repeat(depth)

function special(value: unknown, lang: CodeLanguage): string | null {
  const kind = bsonKind(value)
  const v = value as BsonDoc
  switch (kind) {
    case 'ObjectId': {
      const hex = q(String(v.$oid))
      return { node: `new ObjectId(${hex})`, shell: `ObjectId(${hex})`, python: `ObjectId(${hex})`, go: `oid(${hex})`, java: `new ObjectId(${hex})` }[lang]
    }
    case 'Date': {
      const iso = q(bsonDisplay(value))
      return { node: `new Date(${iso})`, shell: `ISODate(${iso})`, python: `datetime.fromisoformat(${iso.replace('Z"', '+00:00"')})`, go: `mustTime(${iso})`, java: `Date.from(Instant.parse(${iso}))` }[lang]
    }
    case 'Int64': {
      const n = String(v.$numberLong)
      return { node: `Long.fromString(${q(n)})`, shell: `NumberLong(${q(n)})`, python: `Int64(${n})`, go: `int64(${n})`, java: `${n}L` }[lang]
    }
    case 'Decimal128': {
      const d = q(String(v.$numberDecimal))
      return { node: `Decimal128.fromString(${d})`, shell: `NumberDecimal(${d})`, python: `Decimal128(${d})`, go: `mustDecimal(${d})`, java: `new Decimal128(new BigDecimal(${d}))` }[lang]
    }
    case 'Int32':
    case 'Double':
      return bsonDisplay(value)
    default:
      return null
  }
}

/** Renders an Extended JSON value as a literal of the target language. */
export function literal(value: unknown, lang: CodeLanguage, depth = 0): string {
  const sp = special(value, lang)
  if (sp != null) return sp
  if (value === null || value === undefined) return { node: 'null', shell: 'null', python: 'None', go: 'nil', java: 'null' }[lang]
  if (typeof value === 'boolean') return lang === 'python' ? (value ? 'True' : 'False') : String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return q(value)
  if (Array.isArray(value)) {
    if (!value.length) return { node: '[]', shell: '[]', python: '[]', go: 'bson.A{}', java: 'Arrays.asList()' }[lang]
    const items = value.map((item) => `${pad(depth + 1)}${literal(item, lang, depth + 1)}`)
    if (lang === 'go') return `bson.A{\n${items.join(',\n')},\n${pad(depth)}}`
    if (lang === 'java') return `Arrays.asList(\n${items.join(',\n')}\n${pad(depth)})`
    return `[\n${items.join(',\n')}\n${pad(depth)}]`
  }
  const entries = Object.entries(value as BsonDoc)
  if (lang === 'java') {
    if (!entries.length) return 'new Document()'
    return entries.reduce((acc, [k, v], i) => (i === 0
      ? `new Document(${q(k)}, ${literal(v, lang, depth + 1)})`
      : `${acc}\n${pad(depth + 1)}.append(${q(k)}, ${literal(v, lang, depth + 1)})`), '')
  }
  if (!entries.length) return lang === 'go' ? 'bson.D{}' : '{}'
  if (lang === 'go') {
    return `bson.D{\n${entries.map(([k, v]) => `${pad(depth + 1)}{Key: ${q(k)}, Value: ${literal(v, lang, depth + 1)}}`).join(',\n')},\n${pad(depth)}}`
  }
  const key = (k: string) => (lang !== 'python' && /^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k))
  return `{\n${entries.map(([k, v]) => `${pad(depth + 1)}${key(k)}: ${literal(v, lang, depth + 1)}`).join(',\n')}\n${pad(depth)}}`
}

const nonEmpty = (doc?: BsonDoc | null): doc is BsonDoc => !!doc && Object.keys(doc).length > 0

const GO_HELPERS: [string, string][] = [
  ['oid(', 'func oid(hex string) bson.ObjectID { id, _ := bson.ObjectIDFromHex(hex); return id }'],
  ['mustTime(', 'func mustTime(s string) time.Time { t, _ := time.Parse(time.RFC3339Nano, s); return t }'],
  ['mustDecimal(', 'func mustDecimal(s string) bson.Decimal128 { d, _ := bson.ParseDecimal128(s); return d }'],
]

export function generateCode(req: CodeRequest, lang: CodeLanguage): string {
  const code = generateBody(req, lang)
  if (lang !== 'go') return code
  const helpers = GO_HELPERS.filter(([marker]) => code.includes(marker)).map(([, fn]) => fn)
  return helpers.length ? `${code}\n\n// helpers\n${helpers.join('\n')}` : code
}

function generateBody(req: CodeRequest, lang: CodeLanguage): string {
  const { db, collection } = req
  if (req.kind === 'aggregate') {
    const pipeline = literal(req.pipeline, lang)
    switch (lang) {
      case 'shell': return `use(${q(db)})\ndb.getCollection(${q(collection)}).aggregate(${pipeline})`
      case 'node': return `const { MongoClient, ObjectId, Long, Decimal128 } = require('mongodb')\n\nconst client = new MongoClient(process.env.MONGODB_URI)\nconst coll = client.db(${q(db)}).collection(${q(collection)})\nconst docs = await coll.aggregate(${pipeline}).toArray()`
      case 'python': return `import os\nfrom datetime import datetime\nfrom bson import ObjectId, Int64, Decimal128\nfrom pymongo import MongoClient\n\nclient = MongoClient(os.environ["MONGODB_URI"])\ncoll = client[${q(db)}][${q(collection)}]\ndocs = list(coll.aggregate(${pipeline}))`
      case 'go': return `coll := client.Database(${q(db)}).Collection(${q(collection)})\npipeline := mongo.Pipeline${pipeline.replace(/^bson\.A/, '')}\ncursor, err := coll.Aggregate(ctx, pipeline)`
      case 'java': return `MongoCollection<Document> coll = client.getDatabase(${q(db)}).getCollection(${q(collection)});\nList<Document> docs = coll.aggregate(${pipeline}).into(new ArrayList<>());`
    }
  }
  const { filter, projection, sort, skip, limit } = req
  const f = literal(filter, lang)
  switch (lang) {
    case 'shell': {
      let chain = `db.getCollection(${q(collection)}).find(${f}${nonEmpty(projection) ? `, ${literal(projection, lang)}` : ''})`
      if (nonEmpty(sort)) chain += `.sort(${literal(sort, lang)})`
      if (skip) chain += `.skip(${skip})`
      if (limit) chain += `.limit(${limit})`
      return `use(${q(db)})\n${chain}`
    }
    case 'node': {
      const opts = [nonEmpty(projection) && `projection: ${literal(projection, lang, 1)}`, nonEmpty(sort) && `sort: ${literal(sort, lang, 1)}`, skip && `skip: ${skip}`, limit && `limit: ${limit}`].filter(Boolean)
      return `const { MongoClient, ObjectId, Long, Decimal128 } = require('mongodb')\n\nconst client = new MongoClient(process.env.MONGODB_URI)\nconst coll = client.db(${q(db)}).collection(${q(collection)})\nconst docs = await coll.find(${f}${opts.length ? `, {\n  ${opts.join(',\n  ')}\n}` : ''}).toArray()`
    }
    case 'python': {
      let chain = `coll.find(${f}${nonEmpty(projection) ? `, ${literal(projection, lang)}` : ''})`
      if (nonEmpty(sort)) chain += `.sort(list(${literal(sort, lang)}.items()))`
      if (skip) chain += `.skip(${skip})`
      if (limit) chain += `.limit(${limit})`
      return `import os\nfrom datetime import datetime\nfrom bson import ObjectId, Int64, Decimal128\nfrom pymongo import MongoClient\n\nclient = MongoClient(os.environ["MONGODB_URI"])\ncoll = client[${q(db)}][${q(collection)}]\ndocs = list(${chain})`
    }
    case 'go': {
      const opts = [nonEmpty(projection) && `SetProjection(${literal(projection, lang, 1)})`, nonEmpty(sort) && `SetSort(${literal(sort, lang, 1)})`, skip && `SetSkip(${skip})`, limit && `SetLimit(${limit})`].filter(Boolean)
      return `coll := client.Database(${q(db)}).Collection(${q(collection)})\nfilter := ${f}\nopts := options.Find()${opts.map((o) => `.\n  ${o}`).join('')}\ncursor, err := coll.Find(ctx, filter, opts)`
    }
    case 'java': {
      let chain = `coll.find(${f})`
      if (nonEmpty(projection)) chain += `\n  .projection(${literal(projection, lang, 1)})`
      if (nonEmpty(sort)) chain += `\n  .sort(${literal(sort, lang, 1)})`
      if (skip) chain += `\n  .skip(${skip})`
      if (limit) chain += `\n  .limit(${limit})`
      return `MongoCollection<Document> coll = client.getDatabase(${q(db)}).getCollection(${q(collection)});\nList<Document> docs = ${chain}\n  .into(new ArrayList<>());`
    }
  }
}
