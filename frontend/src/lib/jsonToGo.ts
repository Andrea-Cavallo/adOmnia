// JSON sample → Go struct declarations with json tags. Pure and dependency-free so any
// panel holding a JSON payload (Kafka messages, responses, JSON Studio) can offer it.

const INITIALISMS = new Set(['id', 'url', 'uri', 'api', 'http', 'https', 'json', 'xml', 'sql', 'uuid', 'ip', 'tcp', 'udp', 'html', 'css', 'ttl', 'cpu', 'ram', 'os', 'utc', 'sku', 'dlq'])
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** order_id → OrderID, "first-name" → FirstName; always a valid exported identifier. */
export function goName(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
  let name = words.map((w) => (INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join('')
  if (!name) name = 'Field'
  if (/^\d/.test(name)) name = `F${name}`
  return name // exported, so never a Go keyword
}

interface Ctx {
  decls: Map<string, string>
  used: Set<string>
}

function uniqueType(ctx: Ctx, base: string): string {
  let name = base
  for (let i = 2; ctx.used.has(name); i++) name = `${base}${i}`
  ctx.used.add(name)
  return name
}

function scalarType(values: unknown[]): string {
  const kinds = new Set(values.filter((v) => v !== null).map((v) => {
    if (typeof v === 'number') return Number.isInteger(v) ? 'int64' : 'float64'
    if (typeof v === 'string') return RFC3339.test(v) ? 'time.Time' : 'string'
    if (typeof v === 'boolean') return 'bool'
    return 'any'
  }))
  if (kinds.size === 0) return 'any'
  if (kinds.size === 2 && kinds.has('int64') && kinds.has('float64')) return 'float64'
  if (kinds.size === 2 && kinds.has('time.Time') && kinds.has('string')) return 'string'
  return kinds.size === 1 ? [...kinds][0] : 'any'
}

/** Go type for every sample of one position (a field across array items, or array elements). */
function typeOf(ctx: Ctx, samples: unknown[], hint: string): string {
  const present = samples.filter((v) => v !== null && v !== undefined)
  if (present.length === 0) return 'any'
  if (present.every((v) => Array.isArray(v))) {
    return `[]${typeOf(ctx, (present as unknown[][]).flat(), hint)}`
  }
  if (present.every((v) => typeof v === 'object' && !Array.isArray(v))) {
    return structOf(ctx, present as Record<string, unknown>[], hint)
  }
  if (present.some((v) => typeof v === 'object')) return 'any'
  const t = scalarType(present)
  // null means "may be absent"; a missing key is handled by omitempty instead.
  return samples.some((v) => v === null) && t !== 'any' ? `*${t}` : t
}

function structOf(ctx: Ctx, objects: Record<string, unknown>[], hint: string): string {
  const name = uniqueType(ctx, goName(hint))
  ctx.decls.set(name, '') // reserve the slot so a type is declared before the types it contains
  const keys: string[] = []
  for (const o of objects) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
  const fieldNames = new Set<string>()
  const lines = keys.map((key) => {
    let field = goName(key)
    for (let i = 2; fieldNames.has(field); i++) field = `${goName(key)}${i}`
    fieldNames.add(field)
    const optional = objects.some((o) => !(key in o))
    const type = typeOf(ctx, objects.map((o) => o[key]), singular(key))
    const tag = `json:"${key}${optional ? ',omitempty' : ''}"`
    return { field, type, tag }
  })
  const wf = Math.max(0, ...lines.map((l) => l.field.length))
  const wt = Math.max(0, ...lines.map((l) => l.type.length))
  const body = lines.map((l) => `\t${l.field.padEnd(wf)} ${l.type.padEnd(wt)} \`${l.tag}\``).join('\n')
  ctx.decls.set(name, `type ${name} struct {\n${body}${body ? '\n' : ''}}`)
  return name
}

function singular(key: string): string {
  if (/ies$/i.test(key)) return key.replace(/ies$/i, 'y')
  if (/(ss|us)$/i.test(key)) return key
  return key.replace(/s$/i, '')
}

/** Go source for the JSON text; throws on invalid JSON. The root type is declared first. */
export function jsonToGo(json: string, rootName = 'Message'): string {
  const value: unknown = JSON.parse(json)
  const ctx: Ctx = { decls: new Map(), used: new Set() }
  const root = goName(rootName)
  let out: string
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    structOf(ctx, [value as Record<string, unknown>], root)
    out = [...ctx.decls.values()].join('\n\n')
  } else {
    ctx.used.add(root)
    const type = typeOf(ctx, [value], `${root}Item`)
    out = [`type ${root} ${type}`, ...ctx.decls.values()].join('\n\n')
  }
  return out.includes('time.Time') ? `import "time"\n\n${out}\n` : `${out}\n`
}
