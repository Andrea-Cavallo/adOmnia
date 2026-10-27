import * as GoIDEBindings from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { ProjectService } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
import type { ConfiguredDatabase } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/language/models'
import type { DbConnection } from '@/components/database/dbShared'
import { BROKER_PENDING_KEY, DATABASE_PENDING_CONNECTION_KEY, DOCKER_LAB_PENDING_KEY, type DockerLabHandoff } from '@/lib/moduleHandoff'
import { showModule } from '@/lib/moduleRouting'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { requestFromRoute, resolveGoBaseUrl, type CodeStudioHttpRoute } from './codeStudioHttpRoutes'

export type CodeStudioProjectService = ProjectService
export type CodeStudioConfiguredDatabase = ConfiguredDatabase

const LOCAL_HOST = '127.0.0.1'

const DATABASE_DRIVERS: Record<string, { driver: string; port: number }> = {
  postgres: { driver: 'postgres', port: 5432 },
  mysql: { driver: 'mysql', port: 3306 },
  mongodb: { driver: 'mongodb', port: 27017 },
}

/** Stessi indirizzi locali del Docker Lab: un servizio avviato lì è raggiungibile senza modifiche. */
const BROKER_PROFILES: Record<string, unknown> = {
  kafka: { protocol: 'kafka', kafka: { brokers: 'localhost:9092', topic: 'adomnia.lab.events' } },
  rabbitmq: { protocol: 'rabbitmq', rabbitmq: { url: 'amqp://guest:guest@localhost:5672/' } },
  redis: { protocol: 'redis', redis: { addr: 'localhost:6379' } },
}

export function fetchProjectServices(sessionId: string): Promise<CodeStudioProjectService[]> {
  return GoIDEBindings.ProjectServices(sessionId)
}

/**
 * Un database configurato dal progetto (oggi `spring.datasource.*`) è apribile quando il Database
 * Studio ne conosce il driver e la configurazione dice abbastanza per una connessione: ciò che
 * resta non risolto viene chiesto all'utente, mai inventato.
 */
export function canOpenConfiguredDatabase(database: CodeStudioConfiguredDatabase): boolean {
  if (!database.driver) return false
  if (database.driver === 'sqlite') return Boolean(database.database)
  if (!database.host) return false
  if ((database.driver === 'postgres' || database.driver === 'mysql') && !database.database) return false
  return true
}

/** La riga apre Database Studio: con la configurazione del progetto oppure, per una dipendenza
 *  senza configurazione, con i valori locali standard. */
export function canOpenInDatabaseStudio(service: CodeStudioProjectService): boolean {
  if (service.databases?.length) return service.databases.some(canOpenConfiguredDatabase)
  return service.id in DATABASE_DRIVERS
}

export function canOpenInBrokerStudio(service: CodeStudioProjectService): boolean {
  return service.id in BROKER_PROFILES
}

/** Esito del rilevamento di un database configurato, per la UI: cosa è noto e da dove viene. */
export function describeConfiguredDatabase(database: CodeStudioConfiguredDatabase): string {
  const parts: string[] = []
  if (database.host) parts.push(database.port ? `${database.host}:${database.port}` : database.host)
  if (database.database) parts.push(database.database)
  if (database.user) parts.push(`user ${database.user}`)
  if (database.profile) parts.push(`profile ${database.profile}`)
  if (database.file) parts.push(database.line ? `${database.file}:${database.line}` : database.file)
  return parts.join(' · ')
}

/**
 * Connessione proposta al Database Studio a partire da una configurazione Spring: solo i valori
 * noti, nessun segreto (la password dichiarata nel progetto non viene copiata) e un avviso che
 * spiega perché il campo credenziali è vuoto. `null` quando i dati non bastano.
 */
export function configuredDatabaseHandoff(
  service: CodeStudioProjectService,
  database: CodeStudioConfiguredDatabase,
  projectName: string,
): Partial<DbConnection> | null {
  if (!canOpenConfiguredDatabase(database)) return null
  const name = database.name || `${projectName} · ${service.name}`
  const source = database.file || 'the project configuration'
  const warning = database.unresolved?.length
    ? `From ${source}. Not resolved: ${database.unresolved.join(', ')}. Credentials are not imported: enter them for this connection.`
    : `From ${source}. Credentials are not imported: enter them for this connection.`
  if (database.driver === 'sqlite') {
    return { name, driver: 'sqlite', sqlitePath: database.database, credentialWarning: warning }
  }
  const sslMode = database.sslMode && database.sslMode !== 'disable' && database.sslMode !== 'false' ? 'require' : 'disable'
  return {
    name,
    driver: database.driver as DbConnection['driver'],
    host: database.host,
    ...(database.port ? { port: database.port } : {}),
    database: database.database ?? '',
    user: database.user ?? '',
    sslMode,
    credentialWarning: warning,
  }
}

/** Apre la route come nuova richiesta nel client API di adOmnia; la richiesta è una bozza da salvare dove si vuole. */
export function openRouteInApiClient(route: CodeStudioHttpRoute, source: string, origin: string): void {
  const baseUrl = resolveGoBaseUrl(source, useEnvironmentsStore.getState().getResolvedVars())
  const requestSettings = useSettingsStore.getState().settings.requests
  const request = { ...requestFromRoute(route, baseUrl, origin), timeout: requestSettings.defaultTimeoutMs, followRedirects: requestSettings.followRedirects }
  showModule('collections', { kind: 'open-request', request })
}

/** Apre il Docker Lab con i preset dei servizi usati dal progetto in evidenza; l'avvio resta all'utente. */
export function openInDockerLab(services: readonly CodeStudioProjectService[], projectName: string): void {
  showModule('dockerlab', { kind: 'handoff', key: DOCKER_LAB_PENDING_KEY, value: { presetIds: services.map((service) => service.id), source: projectName } satisfies DockerLabHandoff })
}

/**
 * Apre Database Studio con la connessione del progetto: quella dichiarata nella configurazione
 * (Spring) quando c'è, altrimenti una connessione locale per il database della dipendenza.
 */
export function openInDatabaseStudio(service: CodeStudioProjectService, projectName: string, database?: CodeStudioConfiguredDatabase): void {
  if (database) {
    const connection = configuredDatabaseHandoff(service, database, projectName)
    if (connection) showModule('database', { kind: 'handoff', key: DATABASE_PENDING_CONNECTION_KEY, value: connection })
    return
  }
  const target = DATABASE_DRIVERS[service.id]
  if (!target) return
  showModule('database', { kind: 'handoff', key: DATABASE_PENDING_CONNECTION_KEY, value: { name: `${projectName} · ${service.name}`, driver: target.driver, host: LOCAL_HOST, port: target.port, sslMode: 'disable' } })
}

/** Apre Broker Studio sul broker usato dal progetto, all'indirizzo locale standard. */
export function openInBrokerStudio(service: CodeStudioProjectService): void {
  const profile = BROKER_PROFILES[service.id]
  if (!profile) return
  showModule('broker', { kind: 'handoff', key: BROKER_PENDING_KEY, value: profile })
}
