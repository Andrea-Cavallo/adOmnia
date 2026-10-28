import type {
  SpringBean,
  SpringEndpoint,
  SpringIndex,
  SpringInjection,
  SpringProperty,
  SpringValue,
} from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'

/** Posizione navigabile dentro un file del progetto (1-based, come Monaco). */
export interface SpringLocation {
  file: string
  line: number
  startColumn: number
  endColumn: number
}

const CONFIG_PATTERN = /(^|\/)application(-[\w.]+)?\.(properties|ya?ml)$/i

/** È un file di configurazione Spring (application.properties, application-prod.yml, …). */
export function isSpringConfigPath(relativePath: string): boolean {
  return CONFIG_PATTERN.test(relativePath.replace(/\\/g, '/'))
}

export function isJavaPath(relativePath: string): boolean {
  return relativePath.replace(/\\/g, '/').toLowerCase().endsWith('.java')
}

/** Il profilo di un file di configurazione: `application-prod.yml` → "prod". */
export function configProfileOf(relativePath: string): string {
  const name = relativePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const match = /^application(-([\w.]+))?\.(properties|ya?ml)$/i.exec(name)
  return match?.[2]?.toLowerCase() ?? ''
}

export interface TypedKey {
  /** Chiave digitata, con i livelli dei genitori (YAML) già inclusi. */
  key: string
  /** Intervallo da sostituire con il suggerimento scelto. */
  startColumn: number
  endColumn: number
}

/**
 * La chiave che si sta scrivendo su una riga di un `.properties`: i suggerimenti sostituiscono
 * solo la parte già digitata, così la riga resta scrivibile un pezzo alla volta.
 */
export function typedPropertyKey(line: string, column: number): TypedKey {
  const separator = line.search(/[=:]/)
  const end = separator >= 0 ? separator : line.length
  const before = line.slice(0, Math.min(column - 1, end))
  const text = before.trimStart()
  const leading = before.length - text.length
  return { key: text, startColumn: leading + 1, endColumn: end + 1 }
}

/**
 * La chiave completa in un `.yml`, genitori compresi: la indentazione dice il livello, come in Spring.
 */
export function typedYamlKey(lines: readonly string[], lineNumber: number, column: number): TypedKey {
  const line = lines[lineNumber - 1] ?? ''
  const indent = line.length - line.trimStart().length
  const before = line.slice(0, Math.min(column - 1, line.length))
  const own = before.slice(indent).split(':')[0].trim()
  const parents: string[] = []
  for (let index = lineNumber - 2; index >= 0; index--) {
    const candidate = lines[index] ?? ''
    if (!candidate.trim() || candidate.trimStart().startsWith('#')) continue
    const candidateIndent = candidate.length - candidate.trimStart().length
    if (candidateIndent >= indent) continue
    const key = candidate.trim().split(':')[0].trim()
    if (!key) continue
    parents.unshift(key)
    if (candidateIndent === 0) break
  }
  const prefix = parents.length ? `${parents.join('.')}.` : ''
  return {
    key: `${prefix}${own}`,
    startColumn: indent + 1,
    endColumn: indent + own.length + 1,
  }
}

/**
 * Le proprietà che corrispondono a ciò che si sta digitando. Prima quelle con lo stesso prefisso,
 * poi quelle che lo contengono: è l'ordine che si aspetta chi digita `server.po`.
 */
export function springCompletions(index: SpringIndex, typedKey: string, limit = 200): SpringProperty[] {
  const needle = typedKey.toLowerCase()
  const matches = (property: SpringProperty) => !needle || property.name.toLowerCase().includes(needle)
  const prefix: SpringProperty[] = []
  const rest: SpringProperty[] = []
  for (const property of index.properties ?? []) {
    if (!matches(property)) continue
    if (property.name.toLowerCase().startsWith(needle)) prefix.push(property)
    else rest.push(property)
  }
  return [...prefix, ...rest].slice(0, limit)
}

/** I valori scritti in configurazione, uno per chiave: il profilo più specifico vince. */
export function effectiveValues(index: SpringIndex): Map<string, SpringValue> {
  const effective = new Map<string, SpringValue>()
  for (const value of index.values ?? []) {
    const current = effective.get(value.key)
    if (!current || (value.profile && !current.profile)) effective.set(value.key, value)
  }
  return effective
}

/** La documentazione di una proprietà: tipo, default, origine e valore attuale. */
export function propertyMarkdown(property: SpringProperty, values: Map<string, SpringValue>): string {
  const lines: string[] = [`\`${property.name}\``, '']
  if (property.description) lines.push(property.description, '')
  const details: string[] = []
  if (property.type) details.push(`**Type** \`${property.type}\``)
  if (property.default !== undefined && property.default !== '') details.push(`**Default** \`${property.default}\``)
  const value = values.get(property.name)
  if (value) {
    const profile = value.profile ? ` (profile \`${value.profile}\`)` : ''
    details.push(`**Configured** \`${value.value}\`${profile}`)
  }
  if (property.origin) details.push(`**From** ${property.origin}`)
  if (property.deprecated) details.push('**Deprecated**')
  return [...lines, ...details].join('\n')
}

/** La proprietà nota per una chiave, con la sua posizione navigabile se è dichiarata nel progetto. */
export function propertyForValue(index: SpringIndex, key: string): SpringProperty | null {
  return (index.properties ?? []).find((property) => property.name === key) ?? null
}

export function locationOfProperty(property: SpringProperty | null): SpringLocation | null {
  if (!property?.file || !property.line) return null
  return { file: property.file, line: property.line, startColumn: property.startColumn ?? 1, endColumn: property.endColumn ?? property.startColumn ?? 1 }
}

export function locationOfValue(value: SpringValue | null): SpringLocation | null {
  if (!value?.file || !value.line) return null
  return { file: value.file, line: value.line, startColumn: value.startColumn ?? 1, endColumn: value.endColumn ?? value.startColumn ?? 1 }
}

/** La prima occorrenza di una chiave in configurazione: è dove si va da `@Value`. */
export function valueFor(index: SpringIndex, key: string): SpringValue | null {
  return (index.values ?? []).find((value) => value.key === key && !value.profile) ?? (index.values ?? []).find((value) => value.key === key) ?? null
}

/** Il punto di iniezione dichiarato su quella riga del file Java. */
export function injectionAt(index: SpringIndex, file: string, line: number): SpringInjection | null {
  return (index.injections ?? []).find((injection) => sameFile(injection.file, file) && injection.line === line) ?? null
}

/** Il bean che soddisfa un'iniezione: prima per qualificatore, poi per tipo. */
export function beanForInjection(index: SpringIndex, injection: SpringInjection): SpringBean | null {
  const beans = index.beans ?? []
  if (injection.qualifier) {
    const named = beans.find((bean) => bean.name === injection.qualifier || bean.qualifiers?.includes(injection.qualifier ?? ''))
    if (named) return named
  }
  const type = injection.type ?? ''
  const same = (candidate: string) => candidate === type || candidate.endsWith(`.${type}`) || type.endsWith(`.${candidate}`)
  // Prima il tipo esatto, poi un bean che implementa o estende il tipo iniettato (`IOpenAiService` → OpenAiService).
  return beans.find((bean) => same(bean.type ?? '')) ?? beans.find((bean) => (bean.supertypes ?? []).some(same)) ?? null
}

export function locationOfBean(bean: SpringBean | null): SpringLocation | null {
  if (!bean?.file || !bean.line) return null
  return { file: bean.file, line: bean.line, startColumn: bean.startColumn ?? 1, endColumn: bean.endColumn ?? bean.startColumn ?? 1 }
}

/** L'endpoint dichiarato su quella riga del file Java. */
export function endpointAt(index: SpringIndex, file: string, line: number): SpringEndpoint | null {
  return (index.endpoints ?? []).find((endpoint) => sameFile(endpoint.file, file) && endpoint.line === line) ?? null
}

/**
 * Gli endpoint che corrispondono al filtro: cerca nel percorso, nel metodo e nel nome del metodo.
 * È il filtro del pannello degli endpoint: `GET /api`, `orders`, `find`.
 */
export function filterEndpoints(endpoints: readonly SpringEndpoint[], query: string): SpringEndpoint[] {
  const needle = query.trim().toLowerCase()
  const list = [...endpoints]
  const scored = list.map((endpoint, order) => {
    const haystack = `${endpoint.method} ${endpoint.path} ${endpoint.class} ${endpoint.member}`.toLowerCase()
    return { endpoint, order, score: !needle ? 0 : haystack.startsWith(needle) ? 2 : haystack.includes(needle) ? 1 : 0 }
  })
  return scored
    .filter((entry) => !needle || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.endpoint)
}

export function endpointLabel(endpoint: SpringEndpoint): string {
  return `${endpoint.method.padEnd(6)} ${endpoint.path}`
}

/** Le chiavi di configurazione di cui si conosce già un valore: servono per gli override. */
export function overriddenKeys(index: SpringIndex): Set<string> {
  const keys = new Set<string>()
  const seen = new Set<string>()
  for (const value of index.values ?? []) {
    if (value.profile && seen.has(value.key)) keys.add(value.key)
    seen.add(value.key)
  }
  return keys
}

function sameFile(left: string | undefined, right: string): boolean {
  if (!left) return false
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
  return normalize(left) === normalize(right) || normalize(left).endsWith(`/${normalize(right)}`)
}
