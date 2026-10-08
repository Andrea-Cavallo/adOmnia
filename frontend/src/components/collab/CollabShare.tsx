import { useMemo, useState } from 'react'
import { Download, Eye, Inbox, Send, ShieldAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { collabApi, type CollabShare, type CollabShareKind } from '@/lib/collab-api'
import { shareableEnvironments } from '@/lib/collab/receive'
import { QUICK_REQUESTS_COLLECTION_ID, useCollectionsStore } from '@/stores/collections'
import { useCollabStore } from '@/stores/collab'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

interface ShareOption {
  key: string
  kind: CollabShareKind
  title: string
  data: () => unknown
}

const KIND_LABEL: Record<CollabShareKind, string> = { collection: 'Collection', request: 'Request', environments: 'Environment' }
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function useShareOptions(): ShareOption[] {
  const collections = useCollectionsStore((s) => s.collections)
  const tabs = useTabsStore((s) => s.tabs)
  const environments = useEnvironmentsStore((s) => s.environments)
  return useMemo(() => {
    const options: ShareOption[] = collections
      .filter((c) => c.id !== QUICK_REQUESTS_COLLECTION_ID)
      .map((c) => ({ key: `c:${c.id}`, kind: 'collection', title: c.name, data: () => c }))
    for (const tab of tabs) {
      if (tab.tool) continue
      options.push({ key: `r:${tab.id}`, kind: 'request', title: `${tab.request.method} ${tab.request.name || tab.request.url}`, data: () => tab.request })
    }
    const envs = shareableEnvironments(environments)
    if (envs.length) options.push({ key: 'envs', kind: 'environments', title: `${envs.length} environment non privati`, data: () => envs })
    return options
  }, [collections, tabs, environments])
}

export function CollabShareColumn() {
  const status = useCollabStore((s) => s.status)
  const share = useCollabStore((s) => s.share)
  const options = useShareOptions()
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<CollabShare | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')

  const option = options.find((o) => o.key === selected)
  const self = status?.participants.find((p) => p.id === status.self)
  const canShare = status?.mode === 'host' || (status?.mode === 'guest' && self?.role !== 'viewer')

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const select = (key: string) => {
    setSelected(key)
    setPreview(null)
    setSent('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold">Condividi</h3>
        <p className="mb-3 text-xs text-text-3">
          {canShare ? 'Scegli cosa inviare: prima vedi esattamente cosa lascia la macchina.' : status?.mode === 'guest' ? 'Il tuo ruolo è Viewer: puoi solo ricevere.' : 'Avvia o raggiungi una sessione per condividere.'}
        </p>
        <div className="flex gap-2">
          <select value={selected} onChange={(e) => select(e.target.value)} disabled={!canShare} className="h-8 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 text-sm disabled:opacity-50" aria-label="Contenuto da condividere">
            <option value="">Seleziona…</option>
            {(['collection', 'request', 'environments'] as const).map((kind) => {
              const group = options.filter((o) => o.kind === kind)
              return group.length ? (
                <optgroup key={kind} label={KIND_LABEL[kind]}>
                  {group.map((o) => <option key={o.key} value={o.key}>{o.title}</option>)}
                </optgroup>
              ) : null
            })}
          </select>
          <Button size="sm" variant="secondary" disabled={!option || busy || !canShare} onClick={() => option && run(async () => setPreview(await collabApi.preview(option.kind, option.title, option.data())))}>
            <Eye className="h-3.5 w-3.5" />Anteprima
          </Button>
        </div>

        {preview && option && (
          <div className="mt-3 rounded-lg border border-border-1 bg-surface-1 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-2">{KIND_LABEL[option.kind]}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{preview.title}</span>
              <span className="text-text-4">{(JSON.stringify(preview.data).length / 1024).toFixed(1)} KB</span>
            </div>
            <RedactionSummary redacted={preview.redacted ?? []} />
            <pre className="mt-2 max-h-48 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[11px] leading-relaxed text-text-2">{JSON.stringify(preview.data, null, 2)}</pre>
            <div className="mt-3 flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => run(async () => {
                await share(option.kind, option.title, option.data())
                setPreview(null)
                setSent(option.title)
              })}>
                <Send className="h-3.5 w-3.5" />Invia ai partecipanti
              </Button>
            </div>
          </div>
        )}
        {sent && <p className="mt-2 text-xs text-status-ok">Inviato: {sent}</p>}
        {error && <p className="mt-2 text-xs text-status-err">{error}</p>}
      </div>
      <InboxList />
    </div>
  )
}

function RedactionSummary({ redacted }: { redacted: string[] }) {
  if (!redacted.length) return <p className="text-xs text-text-3">Nessun segreto rilevato.</p>
  return (
    <details className="text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 text-status-warn">
        <ShieldAlert className="h-3.5 w-3.5" />{redacted.length} valori sensibili rimossi prima dell'invio
      </summary>
      <ul className="mt-1 max-h-24 overflow-auto pl-5 font-mono text-text-4">
        {redacted.map((path) => <li key={path}>{path}</li>)}
      </ul>
    </details>
  )
}

function InboxList() {
  const { inbox, accept, dismiss } = useCollabStore()
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Inbox className="h-3.5 w-3.5 text-accent" />Ricevuti · {inbox.length}</h3>
      {inbox.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 px-3 py-6 text-center text-xs text-text-4">Quando qualcuno condivide qualcosa appare qui. Niente viene importato senza il tuo consenso.</p>
      ) : (
        <ul className="space-y-1.5">
          {inbox.map((item) => (
            <li key={item.id} className={cn('flex items-center gap-2 rounded-lg border bg-surface-1 px-3 py-2 text-sm', item.error ? 'border-status-err' : 'border-border-1')}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{item.title}</div>
                <div className="truncate text-xs text-text-3">
                  da {item.from} · {new Date(item.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {item.redacted.length > 0 && ` · ${item.redacted.length} segreti da reinserire`}
                  {item.hasScripts && <span className="text-status-warn"> · contiene script: rivedili prima di eseguire</span>}
                  {item.error && <span className="text-status-err"> · {item.error}</span>}
                </div>
              </div>
              {item.content && (
                <Button size="sm" variant="secondary" onClick={() => accept(item.id)}>
                  <Download className="h-3.5 w-3.5" />{item.content.kind === 'request' ? 'Apri' : 'Importa'}
                </Button>
              )}
              <button type="button" onClick={() => dismiss(item.id)} className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text-1" aria-label="Scarta">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
