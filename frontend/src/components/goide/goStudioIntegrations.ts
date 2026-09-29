import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { ProjectService } from '../../../bindings/adomnia/internal/goide/models'
import { BROKER_PENDING_KEY, DATABASE_PENDING_CONNECTION_KEY, DOCKER_LAB_PENDING_KEY, handOff, type DockerLabHandoff } from '@/lib/moduleHandoff'
import { useAppStore } from '@/stores/app'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { requestFromRoute, resolveGoBaseUrl, type GoStudioHttpRoute } from './goStudioHttpRoutes'

export type GoStudioProjectService = ProjectService

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

export function fetchProjectServices(sessionId: string): Promise<GoStudioProjectService[]> {
  return GoIDEBindings.ProjectServices(sessionId)
}

export function canOpenInDatabaseStudio(service: GoStudioProjectService): boolean {
  return service.id in DATABASE_DRIVERS
}

export function canOpenInBrokerStudio(service: GoStudioProjectService): boolean {
  return service.id in BROKER_PROFILES
}

/** Apre la route come nuova richiesta nel client API di adOmnia; la richiesta è una bozza da salvare dove si vuole. */
export function openRouteInApiClient(route: GoStudioHttpRoute, source: string, origin: string): void {
  const baseUrl = resolveGoBaseUrl(source, useEnvironmentsStore.getState().getResolvedVars())
  const requestSettings = useSettingsStore.getState().settings.requests
  const request = { ...requestFromRoute(route, baseUrl, origin), timeout: requestSettings.defaultTimeoutMs, followRedirects: requestSettings.followRedirects }
  useTabsStore.getState().openTab(request)
  useAppStore.getState().setActiveRail('collections')
}

/** Apre il Docker Lab con i preset dei servizi usati dal progetto in evidenza; l'avvio resta all'utente. */
export function openInDockerLab(services: readonly GoStudioProjectService[], projectName: string): void {
  handOff(DOCKER_LAB_PENDING_KEY, { presetIds: services.map((service) => service.id), source: projectName } satisfies DockerLabHandoff)
  useAppStore.getState().setActiveRail('dockerlab')
}

/** Apre Database Studio con una connessione locale per il database del progetto (credenziali da inserire). */
export function openInDatabaseStudio(service: GoStudioProjectService, projectName: string): void {
  const target = DATABASE_DRIVERS[service.id]
  if (!target) return
  handOff(DATABASE_PENDING_CONNECTION_KEY, { name: `${projectName} · ${service.name}`, driver: target.driver, host: LOCAL_HOST, port: target.port, sslMode: 'disable' })
  useAppStore.getState().setActiveRail('database')
}

/** Apre Broker Studio sul broker usato dal progetto, all'indirizzo locale standard. */
export function openInBrokerStudio(service: GoStudioProjectService): void {
  const profile = BROKER_PROFILES[service.id]
  if (!profile) return
  handOff(BROKER_PENDING_KEY, profile)
  useAppStore.getState().setActiveRail('broker')
}
