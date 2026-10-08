import { useEffect, useState } from 'react'
import { Check, Copy, Crown, LogIn, Plus, Radio, ShieldCheck, Unplug, UserX, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { collabApi, type CollabParticipant, type CollabRole } from '@/lib/collab-api'
import { useCollabStore } from '@/stores/collab'
import { CollabShareColumn } from './CollabShare'

const NAME_KEY = 'adomnia.collab.name'
const ROLES: { id: CollabRole; label: string; hint: string }[] = [
  { id: 'viewer', label: 'Viewer', hint: 'riceve, non condivide' },
  { id: 'editor', label: 'Editor', hint: 'riceve e condivide' },
  { id: 'controller', label: 'Controller', hint: 'come Editor; controllo debug/terminale in futuro' },
]

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // solo comodità per-utente: senza storage si reinserisce il nome
  }
}

export function CollabPanel() {
  const { status, init, notice, clearNotice } = useCollabStore()
  const [name, setName] = useState(readName)
  useEffect(() => init(), [init])
  useEffect(() => saveName(name), [name])

  const active = status && status.mode !== 'idle'
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0 text-text-1">
      <header className="flex items-center gap-3 border-b border-border-1 px-4 py-3">
        <Users className="h-4 w-4 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Live Collaboration</h2>
          <p className="text-xs text-text-3">Condividi collection, request ed environment in LAN. Nessun account, traffico cifrato, segreti esclusi.</p>
        </div>
        <SessionBadge mode={status?.mode ?? 'idle'} />
      </header>
      {notice && (
        <button type="button" onClick={clearNotice} className="border-b border-border-1 bg-surface-2 px-4 py-1.5 text-left text-xs text-text-2 hover:bg-surface-3">
          {notice}
        </button>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-border-1 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <section className="min-h-0 overflow-auto bg-surface-0 p-4">
          <label className="mb-4 block text-xs text-text-3">
            Il tuo nome
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="es. Andrea" className="mt-1 block h-8 w-full rounded border border-border-2 bg-surface-1 px-2 text-sm text-text-1 focus:border-accent focus:outline-none" />
          </label>
          {active ? <ActiveSession /> : <StartSession name={name} />}
        </section>
        <section className="min-h-0 overflow-auto bg-surface-0 p-4">
          <CollabShareColumn />
        </section>
      </div>
    </div>
  )
}

function SessionBadge({ mode }: { mode: string }) {
  const label = mode === 'host' ? 'Host' : mode === 'guest' ? 'Connesso' : 'Offline'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs', mode === 'idle' ? 'border-border-2 text-text-3' : 'border-accent text-accent')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', mode === 'idle' ? 'bg-text-4' : 'bg-accent')} />
      {label}
    </span>
  )
}

function StartSession({ name }: { name: string }) {
  const { host, join } = useCollabStore()
  const [addresses, setAddresses] = useState<string[]>([])
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('0')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'host' | 'join' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    collabApi.localAddresses().then((list) => {
      setAddresses(list)
      setIp((current) => current || list[0] || '')
    }).catch((err) => setError(errorText(err)))
  }, [])

  const run = async (kind: 'host' | 'join', action: () => Promise<void>) => {
    setBusy(kind)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  const portNumber = Number.parseInt(port, 10)
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-1 bg-surface-1 p-3">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Radio className="h-3.5 w-3.5 text-accent" />Ospita una sessione</h3>
        <p className="mb-3 text-xs text-text-3">Apre una porta cifrata solo sull'interfaccia scelta. Il sistema può chiedere il permesso del firewall.</p>
        <div className="flex gap-2">
          <select value={ip} onChange={(e) => setIp(e.target.value)} className="h-8 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 text-sm" aria-label="Indirizzo">
            {addresses.length === 0 && <option value="">Nessuna rete disponibile</option>}
            {addresses.map((a) => <option key={a} value={a}>{a}</option>)}
            <option value="127.0.0.1">127.0.0.1 (solo questa macchina)</option>
          </select>
          <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="h-8 w-20 rounded border border-border-2 bg-surface-0 px-2 text-sm" aria-label="Porta (0 = automatica)" title="Porta (0 = automatica)" />
          <Button size="sm" disabled={!ip || busy !== null || !(portNumber >= 0 && portNumber <= 65535)} onClick={() => run('host', () => host(ip, portNumber, name))}>
            {busy === 'host' ? 'Avvio…' : 'Ospita'}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-border-1 bg-surface-1 p-3">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><LogIn className="h-3.5 w-3.5 text-accent" />Partecipa</h3>
        <p className="mb-3 text-xs text-text-3">Incolla il codice ricevuto dall'host. Il certificato dell'host viene verificato con l'impronta contenuta nel codice.</p>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={3} placeholder="adomnia-collab://…" className="mb-2 block w-full resize-none rounded border border-border-2 bg-surface-0 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none" />
        <Button size="sm" variant="secondary" disabled={!code.trim() || busy !== null} onClick={() => run('join', () => join(code, name))}>
          {busy === 'join' ? 'Connessione…' : 'Partecipa'}
        </Button>
      </div>
      {error && <p className="text-xs text-status-err">{error}</p>}
    </div>
  )
}

function ActiveSession() {
  const { status, invites, stop, createInvite, setRole, revoke } = useCollabStore()
  const [role, setInviteRole] = useState<CollabRole>('editor')
  const [ttl, setTtl] = useState(15)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  if (!status) return null
  const isHost = status.mode === 'host'

  const guard = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorText(err))
    }
  }
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(text)
      window.setTimeout(() => setCopied(''), 1500)
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-1 bg-surface-1 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-text-2">{status.address}</span>
          <Button size="sm" variant="outline" onClick={() => guard(stop)}>
            <Unplug className="h-3.5 w-3.5" />{isHost ? 'Chiudi sessione' : 'Esci'}
          </Button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-text-3" title={status.fingerprint}>
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="break-all">TLS 1.3 · impronta {status.fingerprint?.slice(0, 16)}…</span>
        </p>
      </div>

      {isHost && (
        <div className="rounded-lg border border-border-1 bg-surface-1 p-3">
          <h3 className="mb-2 text-sm font-semibold">Invita</h3>
          <div className="flex flex-wrap gap-2">
            <select value={role} onChange={(e) => setInviteRole(e.target.value as CollabRole)} className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-sm" aria-label="Ruolo">
              {ROLES.map((r) => <option key={r.id} value={r.id} title={r.hint}>{r.label}</option>)}
            </select>
            <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-sm" aria-label="Scadenza">
              {[5, 15, 60, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
            <Button size="sm" onClick={() => guard(() => createInvite(role, ttl))}><Plus className="h-3.5 w-3.5" />Nuovo invito</Button>
          </div>
          <p className="mt-2 text-xs text-text-4">Ogni invito vale per una sola persona e scade da solo.</p>
          <ul className="mt-2 space-y-1.5">
            {invites.map((inv) => (
              <li key={inv.code} className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-xs">
                <span className="w-16 shrink-0 capitalize text-text-2">{inv.role}</span>
                <code className="min-w-0 flex-1 truncate text-text-3">{inv.code}</code>
                <span className="shrink-0 text-text-4">fino alle {new Date(inv.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" onClick={() => copy(inv.code)} className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text-1" aria-label="Copia invito">
                  {copied === inv.code ? <Check className="h-3.5 w-3.5 text-status-ok" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Partecipanti · {status.participants.length}</h3>
        <ul className="space-y-1">
          {status.participants.map((p) => (
            <ParticipantRow key={p.id} participant={p} self={p.id === status.self} editable={isHost && !p.host} onRole={(r) => guard(() => setRole(p.id, r))} onRevoke={() => guard(() => revoke(p.id))} />
          ))}
        </ul>
      </div>
      {error && <p className="text-xs text-status-err">{error}</p>}
    </div>
  )
}

interface ParticipantRowProps {
  participant: CollabParticipant
  self: boolean
  editable: boolean
  onRole: (role: CollabRole) => void
  onRevoke: () => void
}

function ParticipantRow({ participant, self, editable, onRole, onRevoke }: ParticipantRowProps) {
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-1">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold uppercase text-text-2">{participant.name.slice(0, 1)}</span>
      <span className="min-w-0 flex-1 truncate">
        {participant.name}
        {self && <span className="ml-1 text-xs text-text-4">(tu)</span>}
        {participant.address && <span className="ml-2 font-mono text-xs text-text-4">{participant.address}</span>}
      </span>
      {participant.host ? (
        <span className="inline-flex items-center gap-1 text-xs text-accent"><Crown className="h-3 w-3" />Host</span>
      ) : editable ? (
        <>
          <select value={participant.role} onChange={(e) => onRole(e.target.value as CollabRole)} className="h-7 rounded border border-border-2 bg-surface-0 px-1.5 text-xs" aria-label={`Ruolo di ${participant.name}`}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" onClick={onRevoke} className="rounded p-1 text-text-3 hover:bg-surface-2 hover:text-status-err" aria-label={`Rimuovi ${participant.name}`} title="Rimuovi dalla sessione">
            <UserX className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <span className="text-xs capitalize text-text-3">{participant.role}</span>
      )}
    </li>
  )
}
