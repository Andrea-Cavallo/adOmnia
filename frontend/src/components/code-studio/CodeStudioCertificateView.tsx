import { useEffect, useState, type ReactNode } from 'react'
import { Code2, FileWarning, KeyRound, Loader2, LockKeyhole, ShieldCheck, Table2 } from 'lucide-react'
import { inspectCertificate, type CertificateInfo } from '@/lib/code-studio-api'
import { certificateValidity, distinguishedName, type CertificateValidity } from '@/lib/code-studio/certificateDocument'
import { useAppStore } from '@/stores/app'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'

type CertificateMode = 'details' | 'source'

/** Attesa dopo l'ultima battitura prima di rileggere il PEM. */
const INSPECT_DEBOUNCE_MS = 250

const MODES: { id: CertificateMode; label: string; icon: typeof Table2 }[] = [
  { id: 'details', label: 'Decoded details', icon: Table2 },
  { id: 'source', label: 'PEM source', icon: Code2 },
]

const VALIDITY: Record<CertificateValidity, { label: string; className: string }> = {
  valid: { label: 'Valid', className: 'border-success/30 bg-success/10 text-success' },
  expiring: { label: 'Expiring soon', className: 'border-warning/30 bg-warning/10 text-warning' },
  expired: { label: 'Expired', className: 'border-danger/30 bg-danger/10 text-danger' },
  'not-yet-valid': { label: 'Not yet valid', className: 'border-warning/30 bg-warning/10 text-warning' },
}

/** Rilegge i blocchi PEM del buffer, con debounce: segue anche le modifiche non salvate. */
function useCertificateInfo(text: string): { items: CertificateInfo[]; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ items: CertificateInfo[]; error: string | null; loading: boolean }>({ items: [], error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      inspectCertificate(text)
        .then((items) => { if (!cancelled) setState({ items, error: null, loading: false }) })
        .catch((error: unknown) => { if (!cancelled) setState({ items: [], error: error instanceof Error ? error.message : String(error), loading: false }) })
    }, INSPECT_DEBOUNCE_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [text])
  return state
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-4">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-text-1 [overflow-wrap:anywhere]">{children}</dd>
    </>
  )
}

function CertificateCard({ info }: { info: CertificateInfo }) {
  const validity = certificateValidity(info)
  const badge = VALIDITY[validity]
  const days = info.daysRemaining >= 0 ? `${info.daysRemaining} days left` : `${-info.daysRemaining} days ago`
  return (
    <section className="rounded-lg border border-border-1 bg-surface-1" aria-label={`Certificate ${info.subject.cn || ''}`}>
      <header className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
        <ShieldCheck size={14} className="shrink-0 text-accent" />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text-1">{info.subject.cn || distinguishedName(info.subject) || 'Certificate'}</h3>
        {info.isCA && <span className="rounded border border-border-2 px-1.5 py-0.5 text-[10px] text-text-3">CA</span>}
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
      </header>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-2.5 text-[11.5px]">
        <Row label="Subject">{distinguishedName(info.subject) || '—'}</Row>
        <Row label="Issuer">{distinguishedName(info.issuer) || '—'}</Row>
        <Row label="Valid from">{info.notBefore}</Row>
        <Row label="Valid until">{info.notAfter} <span className="font-sans text-text-4">({days})</span></Row>
        {info.sans.length > 0 && <Row label="Subject alt names">{info.sans.join(', ')}</Row>}
        <Row label="Public key">{[info.publicKeyAlgorithm, info.keyBits ? `${info.keyBits} bits` : ''].filter(Boolean).join(' · ')}</Row>
        <Row label="Signature">{info.signatureAlgorithm}</Row>
        {info.keyUsage.length > 0 && <Row label="Key usage">{info.keyUsage.join(', ')}</Row>}
        {info.extKeyUsage.length > 0 && <Row label="Extended key usage">{info.extKeyUsage.join(', ')}</Row>}
        <Row label="Serial number">{info.serialNumber}</Row>
        <Row label="SHA-256">{info.sha256}</Row>
        <Row label="SHA-1">{info.sha1}</Row>
      </dl>
    </section>
  )
}

function KeyCard({ info, onOpenInPowerTools }: { info: CertificateInfo; onOpenInPowerTools: () => void }) {
  const Icon = info.encrypted ? LockKeyhole : KeyRound
  const summary = info.encrypted
    ? 'Encrypted private key: its password is needed to use or read it.'
    : [info.publicKeyAlgorithm, info.keyBits ? `${info.keyBits} bits` : ''].filter(Boolean).join(' · ')
  return (
    <section className="rounded-lg border border-border-1 bg-surface-1" aria-label={info.blockType}>
      <header className="flex items-center gap-2 px-3 py-2">
        <Icon size={14} className={`shrink-0 ${info.encrypted ? 'text-warning' : 'text-accent'}`} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-semibold text-text-1">{info.blockType}</h3>
          <p className="text-[11.5px] text-text-3">{info.error || summary}</p>
        </div>
        <button type="button" onClick={onOpenInPowerTools} className="gs-btn gs-btn-secondary gs-btn-sm" title="Open this file in the Power Tools PEM key encryptor">
          {info.encrypted ? 'Decrypt…' : 'Encrypt…'}
        </button>
      </header>
    </section>
  )
}

function OtherBlockCard({ info }: { info: CertificateInfo }) {
  return (
    <section className="flex items-start gap-2 rounded-lg border border-border-1 bg-surface-1 px-3 py-2 text-[11.5px]" aria-label={info.blockType}>
      <FileWarning size={14} className="mt-0.5 shrink-0 text-text-4" />
      <div className="min-w-0">
        <h3 className="text-[12.5px] font-semibold text-text-1">{info.blockType}</h3>
        <p className="text-text-3">{info.error}</p>
      </div>
    </section>
  )
}

function isPrivateKey(info: CertificateInfo): boolean {
  return info.blockType.endsWith('PRIVATE KEY')
}

/**
 * Un file PEM (.pem, .crt, .cer, .key) si apre già decodificato con la stessa lettura del tool PEM di
 * Power Tools: certificati con soggetto, scadenza, SAN e impronte; chiavi private con tipo e cifratura.
 * Nessuna chiave viene decifrata senza password: il pulsante apre il cifratore di Power Tools.
 */
export function CodeStudioCertificateDocument({ document, editor }: { document: GoIDEEditorDocument; editor: ReactNode }) {
  const [modes, setModes] = useState<Record<string, CertificateMode>>({})
  const mode = modes[document.document.id] ?? 'details'
  const { items, error, loading } = useCertificateInfo(document.buffer)

  const openInPowerTools = () => {
    const app = useAppStore.getState()
    app.queueFileImport({ kind: 'pem', name: document.document.name, text: document.buffer })
    app.setActiveRail('powertools')
  }

  let details: ReactNode
  if (error) {
    details = <p role="alert" className="text-[12px] text-danger">{error}</p>
  } else if (loading && items.length === 0) {
    details = <p className="flex items-center gap-2 text-[12px] text-text-3"><Loader2 size={13} className="animate-spin" />Reading the PEM blocks…</p>
  } else {
    details = items.map((info, index) => {
      const key = `${index}-${info.blockType}`
      if (info.blockType === 'CERTIFICATE' && !info.error) return <CertificateCard key={key} info={info} />
      if (isPrivateKey(info)) return <KeyCard key={key} info={info} onOpenInPowerTools={openInPowerTools} />
      return <OtherBlockCard key={key} info={info} />
    })
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {mode === 'source'
        ? <div className="min-h-0 min-w-0 flex-1">{editor}</div>
        : <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--gs-island,var(--color-surface-0))] p-4"><div className="mx-auto flex max-w-3xl flex-col gap-3 pt-6">{details}</div></div>}
      <div role="radiogroup" aria-label="Certificate view" className="absolute right-4 top-2 z-10 flex gap-0.5 rounded-lg border border-border-1 bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} aria-label={label} title={label} onClick={() => setModes((current) => ({ ...current, [document.document.id]: id }))} className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${mode === id ? 'bg-accent/20 text-accent' : 'text-text-4 hover:bg-surface-3 hover:text-text-2'}`}>
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}
