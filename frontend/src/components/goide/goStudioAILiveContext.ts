import { GetServerPort } from '../../../bindings/adomnia/app'
import { getDevContext, type DevEntity } from '@/lib/devcontext-api'
import { safeStorageGet } from '@/lib/wailsStorage'
import { serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { listBrokerConnectionProfiles, loadLastBrokerConnection, resolveBrokerPayload } from '@/lib/brokerConnections'
import { CONNECTIONS_KEY, STORAGE_BUCKET, normalizeConnection, type DbConnection, type DbDriver, type DbResult } from '@/components/database/dbShared'
import { hydrateDatabaseConnections, resolveDatabaseConnection } from '@/components/database/dbSecrets'

/**
 * Contesto "live" per le azioni AI: lo schema del database e i metadati Kafka letti davvero dai
 * servizi del progetto (datasource rilevati da devcontext: .env, compose, config), con le
 * connessioni già salvate in Database Studio e Broker Studio. Solo letture, solo su azione dell'utente.
 */

const LIVE_TIMEOUT_MS = 5000
const MAX_TABLES = 40
const MAX_TOPICS = 8

async function sidecarPost<T>(path: string, body: unknown): Promise<T> {
  const url = serverUrl(await GetServerPort(), path)
  if (!url) throw new Error('Backend not ready')
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS + 1000)
  try {
    const response = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(text.trim() || response.statusText)
    return (text ? JSON.parse(text) : {}) as T
  } finally {
    window.clearTimeout(timer)
  }
}

const sameHost = (a: string | undefined, b: string | undefined) => {
  const local = (host = '') => (host === 'localhost' || host === '::1' ? '127.0.0.1' : host)
  return local(a) === local(b)
}

async function datasources(sessionId: string, types: readonly string[]): Promise<DevEntity[]> {
  const snapshot = await getDevContext(sessionId)
  return snapshot.entities.filter((entity) => entity.kind === 'datasource' && types.includes(entity.attrs.type))
}

/** Colonne di tutte le tabelle, una riga per colonna (table_name, column_name, data_type, is_nullable, column_default). */
export function columnsQuery(driver: DbDriver): string {
  switch (driver) {
    case 'postgres': return "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
    case 'mysql': return 'SELECT table_name, column_name, column_type AS data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position'
    case 'sqlite': return "SELECT m.name AS table_name, p.name AS column_name, p.type AS data_type, CASE p.\"notnull\" WHEN 1 THEN 'NO' ELSE 'YES' END AS is_nullable, p.dflt_value AS column_default FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid"
    default: return ''
  }
}

/** Una riga per tabella; con molte tabelle restano quelle citate dal codice. */
export function formatSchema(rows: ReadonlyArray<Record<string, unknown>>, preferred: readonly string[]): string {
  const tables = new Map<string, string[]>()
  for (const row of rows) {
    const get = (key: string) => String(row[key] ?? row[key.toUpperCase()] ?? '')
    const table = get('table_name')
    if (!table) continue
    const nullable = get('is_nullable').toUpperCase() === 'NO' ? ' NOT NULL' : ''
    const fallback = row.column_default ?? row.COLUMN_DEFAULT
    const defaultValue = fallback === null || fallback === undefined || fallback === '' ? '' : ` DEFAULT ${String(fallback)}`
    tables.set(table, [...(tables.get(table) ?? []), `${get('column_name')} ${get('data_type')}${nullable}${defaultValue}`])
  }
  const wanted = new Set(preferred.map((name) => name.toLowerCase()))
  let names = [...tables.keys()]
  if (names.length > MAX_TABLES) names = [...names.filter((name) => wanted.has(name.toLowerCase())), ...names.filter((name) => !wanted.has(name.toLowerCase()))].slice(0, MAX_TABLES)
  const lines = names.map((name) => `- ${name}(${tables.get(name)!.join(', ')})`)
  return tables.size > names.length ? [...lines, `… and ${tables.size - names.length} more tables`].join('\n') : lines.join('\n')
}

/** Schema del database del progetto, se una connessione salvata in Database Studio corrisponde a un suo datasource. */
export async function liveDatabaseSchema(sessionId: string, codeTables: readonly string[]): Promise<string | undefined> {
  const sources = await datasources(sessionId, ['postgres', 'mysql', 'sqlite'])
  if (!sources.length) return undefined
  const raw = await safeStorageGet(STORAGE_BUCKET, CONNECTIONS_KEY)
  if (!raw) return undefined
  const saved = hydrateDatabaseConnections((JSON.parse(raw) as Partial<DbConnection>[]).map(normalizeConnection))
  for (const source of sources) {
    const connection = saved.find((item) => item.driver === source.attrs.type && (item.driver === 'sqlite'
      ? Boolean(item.sqlitePath)
      : Number(item.port) === Number(source.attrs.port) && sameHost(item.host, source.attrs.host) && (!source.attrs.database || item.database === source.attrs.database)))
    if (!connection) continue
    const result = await sidecarPost<DbResult>('/database/query', { connection: await resolveDatabaseConnection(connection), query: columnsQuery(connection.driver), limit: 2000, timeoutMs: LIVE_TIMEOUT_MS, explain: false, confirm: false })
    const schema = formatSchema(result.rows ?? [], codeTables)
    if (schema) return `${connection.driver} database "${connection.database || connection.name}" (Database Studio connection "${connection.name}"):\n${schema}`
  }
  return undefined
}

interface KafkaBrokerConfig {
  brokers?: string
  tls?: boolean
  saslEnabled?: boolean
  saslMechanism?: string
  saslUsername?: string
  saslPassword?: string
}

interface TopicDetail {
  ok?: boolean
  error?: string
  topic?: string
  partitions?: Array<{ id: number; replicas: number[]; messages: number }>
  configs?: Array<{ name: string; value: string; default: boolean; sensitive: boolean }>
}

export function formatTopic(detail: TopicDetail): string {
  const partitions = detail.partitions ?? []
  const replication = partitions[0]?.replicas.length ?? 0
  const messages = partitions.reduce((sum, partition) => sum + partition.messages, 0)
  const configs = (detail.configs ?? []).filter((config) => !config.default && !config.sensitive).map((config) => `${config.name}=${config.value}`)
  return `- ${detail.topic}: ${partitions.length} partitions, replication ${replication}, ~${messages} messages${configs.length ? `, ${configs.join(', ')}` : ''}`
}

/** Metadati dei topic citati dal codice, letti dal broker Kafka del progetto (con le credenziali di Broker Studio se salvate). */
export async function liveKafkaMetadata(sessionId: string, codeTopics: readonly string[]): Promise<string | undefined> {
  const [source] = await datasources(sessionId, ['kafka'])
  if (!source || !codeTopics.length) return undefined
  const address = `${source.attrs.host}:${source.attrs.port}`
  const known = [await loadLastBrokerConnection<KafkaBrokerConfig>('kafka'), ...(await listBrokerConnectionProfiles<KafkaBrokerConfig>('kafka')).map((profile) => profile.config)]
  const saved = known.find((config) => config?.brokers?.split(',').some((broker) => {
    const [host, port] = broker.trim().split(':')
    return port === source.attrs.port && sameHost(host, source.attrs.host)
  }))
  const config = {
    brokers: (saved?.brokers ?? address).split(',').map((broker) => broker.trim()).filter(Boolean),
    tls: saved?.tls ?? false,
    sasl: saved?.saslEnabled ? { enabled: true, mechanism: saved.saslMechanism, username: saved.saslUsername, password: saved.saslPassword } : undefined,
  }
  const resolved = await resolveBrokerPayload(config)
  const details = await Promise.all(codeTopics.slice(0, MAX_TOPICS).map((topic) => sidecarPost<TopicDetail>('/kafka/topic-detail', { config: resolved, topic }).catch((error: unknown) => ({ ok: false, topic, error: String(error) }))))
  const lines = details.map((detail) => (detail.ok === false ? `- ${detail.topic}: not found on the broker (${detail.error ?? 'error'})` : formatTopic(detail)))
  return `Kafka at ${config.brokers.join(', ')}:\n${lines.join('\n')}`
}
