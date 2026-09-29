import { useEffect, useRef, useState } from 'react'
import { Activity, Boxes, Database, Loader2, Radio, Server, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import {
  canOpenInBrokerStudio, canOpenInDatabaseStudio, fetchProjectServices, openInBrokerStudio, openInDatabaseStudio, openInDockerLab,
  type GoStudioProjectService,
} from './goStudioIntegrations'

interface GoStudioProjectServicesDialogProps {
  sessionId: string
  projectName: string
  open: boolean
  onClose: () => void
}

const KIND_ICON = { database: Database, cache: Server, messaging: Radio, observability: Activity } as const

function KindIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind as keyof typeof KIND_ICON] ?? Boxes
  return <Icon size={13} className="shrink-0 text-accent" />
}

const ACTION_CLASS = 'h-6 shrink-0 rounded border border-border-1 px-2 text-[10px] text-text-2 hover:border-accent/50 hover:bg-surface-2 hover:text-text-1'

/**
 * Servizi usati dal progetto (da go.mod) e scorciatoie verso i moduli adOmnia che li gestiscono.
 * Integrazione a senso unico: Go Studio apre i moduli con il contesto, nulla viene avviato da solo.
 */
export function GoStudioProjectServicesDialog({ sessionId, projectName, open, onClose }: GoStudioProjectServicesDialogProps) {
  const [services, setServices] = useState<GoStudioProjectService[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh] backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Project services" tabIndex={-1} className="w-[min(600px,92vw)] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-4">
          <Boxes size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Project Services</h2>
          <span className="truncate text-[10px] text-text-4">{projectName} · detected from go.mod</span>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="max-h-[50vh] overflow-auto py-1">
          {error && <p role="alert" className="px-4 py-3 text-[11px] text-danger">{error}</p>}
          {!error && services === null && <p className="flex items-center gap-2 px-4 py-3 text-[11px] text-text-4"><Loader2 size={11} className="animate-spin" /> Reading go.mod…</p>}
          {services?.length === 0 && (
            <p className="px-4 py-3 text-[11px] leading-relaxed text-text-4">No database, broker or observability library is a direct dependency of this project. Docker Lab still offers ready-made local stacks.</p>
          )}
          {services?.map((service) => (
            <div key={service.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-2/60">
              <KindIcon kind={service.kind} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-text-1">{service.name}</div>
                <div className="truncate font-mono text-[9px] text-text-4" title={service.modules.join('\n')}>{service.modules.join(', ')}</div>
              </div>
              {canOpenInDatabaseStudio(service) && <button type="button" className={ACTION_CLASS} onClick={() => go(() => openInDatabaseStudio(service, projectName))}>Database Studio</button>}
              {canOpenInBrokerStudio(service) && <button type="button" className={ACTION_CLASS} onClick={() => go(() => openInBrokerStudio(service))}>Broker Studio</button>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border-1 bg-surface-0 px-4 py-2">
          <span className="mr-auto min-w-0 text-[10px] text-text-4">Nothing starts on its own · adOmnia modules do not write back to the project</span>
          <button type="button" onClick={onClose} className="h-7 shrink-0 whitespace-nowrap rounded px-3 text-xs text-text-3 hover:bg-surface-2">Close</button>
          <button type="button" disabled={services === null && !error} onClick={() => go(() => openInDockerLab(services ?? [], projectName))} className="h-7 shrink-0 whitespace-nowrap rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">
            {services?.length ? 'Open in Docker Lab' : 'Browse Docker Lab'}
          </button>
        </div>
      </div>
    </div>
  )
}
