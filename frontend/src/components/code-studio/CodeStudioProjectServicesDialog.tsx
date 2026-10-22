import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Boxes, Database, Loader2, Radio, Server } from 'lucide-react'
import { CodeStudioAlert, CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import {
  canOpenConfiguredDatabase, canOpenInBrokerStudio, canOpenInDatabaseStudio, describeConfiguredDatabase,
  fetchProjectServices, openInBrokerStudio, openInDatabaseStudio, openInDockerLab,
  type CodeStudioConfiguredDatabase, type CodeStudioProjectService,
} from './codeStudioIntegrations'

interface CodeStudioProjectServicesDialogProps {
  sessionId: string
  projectName: string
  open: boolean
  onClose: () => void
}

const KIND_ICON = { database: Database, cache: Server, messaging: Radio, observability: Activity } as const

function KindIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind as keyof typeof KIND_ICON] ?? Boxes
  return <Icon size={15} />
}

/**
 * Un database dichiarato dalla configurazione del progetto (es. Spring `spring.datasource.*`):
 * mostra solo ciò che è scritto, quanto manca e da quale file viene. La connessione si crea in
 * Database Studio e le credenziali le inserisce l'utente.
 */
function ConfiguredDatabaseRow({ service, database, projectName, onOpen }: {
  service: CodeStudioProjectService
  database: CodeStudioConfiguredDatabase
  projectName: string
  onOpen: (action: () => void) => void
}) {
  const target = describeConfiguredDatabase(database)
  const openable = canOpenConfiguredDatabase(database)
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/60">
      <span className={openable ? 'gs-modal-icon gs-tone-accent h-8 w-8' : 'gs-modal-icon gs-tone-warning h-8 w-8'}>
        <Database size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-medium text-text-1">
          <span className="truncate">{database.name || service.name}</span>
          {database.profile && <span className="gs-badge">{database.profile}</span>}
          {database.active && <span className="gs-badge">active</span>}
        </div>
        {target && <div className="gs-mono truncate text-[11px] text-text-4" title={target}>{target}</div>}
        {!database.driver && <div className="text-[11px] text-text-4">{service.name} is not supported by Database Studio.</div>}
        {database.driver && database.unresolved?.length ? (
          <div className="text-[11px] text-text-4">Still needed from you: {database.unresolved.join(', ')}</div>
        ) : null}
      </div>
      {openable && <CodeStudioButton small variant="secondary" onClick={() => onOpen(() => openInDatabaseStudio(service, projectName, database))}>Database Studio</CodeStudioButton>}
    </div>
  )
}

/**
 * Servizi usati dal progetto (dai manifest delle sue unità: go.mod, pyproject.toml, requirements.txt)
 * e database dichiarati nella configurazione (Spring), con scorciatoie verso i moduli adOmnia che li
 * gestiscono. Integrazione a senso unico: Code Studio apre i moduli con il contesto, nulla viene
 * avviato o connesso da solo.
 */
export function CodeStudioProjectServicesDialog({ sessionId, projectName, open, onClose }: CodeStudioProjectServicesDialogProps) {
  const [services, setServices] = useState<CodeStudioProjectService[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setServices(null)
    setError(null)
    fetchProjectServices(sessionId)
      .then(setServices)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [open, sessionId])

  if (!open) return null

  const go = (action: () => void) => { action(); onClose() }

  return (
    <CodeStudioModal
      open={open}
      onClose={onClose}
      size="md"
      divided
      flush
      icon={Boxes}
      title="Project services"
      subtitle={<>{projectName} · detected from the project manifests and configuration</>}
      footerStart="Nothing starts on its own."
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onClose}>Close</CodeStudioButton>
        <CodeStudioButton variant="primary" disabled={services === null && !error} onClick={() => go(() => openInDockerLab(services ?? [], projectName))}>{services?.length ? 'Open in Docker Lab' : 'Browse Docker Lab'}</CodeStudioButton>
      </>}
    >
      <div className="max-h-[52vh] overflow-auto p-1.5">
        {error && <div className="p-3"><CodeStudioAlert icon={AlertCircle}>{error}</CodeStudioAlert></div>}
        {!error && services === null && <p className="gs-list-empty flex items-center justify-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading project manifests and configuration…</p>}
        {services?.length === 0 && <p className="gs-list-empty">No database, broker or observability library is a direct dependency and no datasource is configured. Docker Lab still offers ready-made local stacks.</p>}
        {services?.map((service) => service.databases?.length
          ? service.databases.map((database) => (
              <ConfiguredDatabaseRow key={`${service.id}-${database.name}-${database.file}-${database.line}`} service={service} database={database} projectName={projectName} onOpen={go} />
            ))
          : (
              <div key={service.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-2/60">
                <span className="gs-modal-icon gs-tone-accent h-8 w-8"><KindIcon kind={service.kind} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text-1">{service.name}</div>
                  <div className="gs-mono truncate text-[11px] text-text-4" title={service.modules.join('\n')}>{service.modules.join(', ')}</div>
                </div>
                {canOpenInDatabaseStudio(service) && <CodeStudioButton small variant="secondary" onClick={() => go(() => openInDatabaseStudio(service, projectName))}>Database Studio</CodeStudioButton>}
                {canOpenInBrokerStudio(service) && <CodeStudioButton small variant="secondary" onClick={() => go(() => openInBrokerStudio(service))}>Broker Studio</CodeStudioButton>}
              </div>
            ))}
      </div>
    </CodeStudioModal>
  )
}
