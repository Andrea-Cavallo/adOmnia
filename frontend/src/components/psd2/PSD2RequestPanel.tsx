import { useState } from 'react'
import { BadgeCheck, FileKey2, Loader2, ShieldCheck, Wand2 } from 'lucide-react'
import type { KVRow, PSD2RequestConfig } from '@/lib/types'
import { uid } from '@/lib/types'
import { buildPSD2Headers, inspectPSD2Certificate, selectPSD2Certificate, type PSD2CertificateInfo } from '@/lib/psd2-api'
import { resolveSecret } from '@/lib/vaultRefs'
import { isVaultRef } from '@/lib/vaultRefs'
import type { PSD2ValidationIssue } from '@/lib/psd2Validation'

interface Props {
  config?: PSD2RequestConfig
  headers: KVRow[]
  onConfigChange: (config: PSD2RequestConfig) => void
  onHeadersChange: (headers: KVRow[]) => void
  issues?: PSD2ValidationIssue[]
}

const initialConfig: PSD2RequestConfig = { enabled: false, operation: 'ais-consent', qwacPath: '', qwacPasswordRef: '', qsealPath: '', qsealPasswordRef: '', keyId: '', sign: true }

function CertificateCard({ label, path, passwordRef, onPath, onPassword }: { label: string; path: string; passwordRef: string; onPath: (value: string) => void; onPassword: (value: string) => void }) {
  const [info, setInfo] = useState<PSD2CertificateInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inspect = async () => {
    setLoading(true); setError('')
    try {
      if (passwordRef && !isVaultRef(passwordRef)) throw new Error('Use an encrypted vault: reference; plaintext passwords are not stored.')
      setInfo(await inspectPSD2Certificate(path, await resolveSecret(passwordRef)))
    }
    catch (cause) { setInfo(null); setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }
  return <div className="rounded-md border border-border-2 bg-surface-1 p-2.5">
    <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-2"><FileKey2 size={13} className="text-accent" />{label}</div>
    <div className="flex gap-1.5"><input value={path} onChange={(e) => onPath(e.target.value)} placeholder="Certificate path (.pem, .p12)" className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent" /><button onClick={() => void selectPSD2Certificate().then((value) => value && onPath(value))} className="rounded border border-border-2 px-2 text-[10px] text-text-3 hover:bg-surface-2">Browse</button></div>
    <input value={passwordRef} onChange={(e) => { const value = e.target.value; if (!value || 'vault:'.startsWith(value) || value.startsWith('vault:')) onPassword(value) }} placeholder="vault: encrypted password reference" type="password" className="mt-1.5 h-7 w-full rounded border border-border-2 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent" />
    <p className="mt-1 text-[9px] text-text-4">Plaintext passwords are rejected. Create or paste a Vault reference.</p>
    <button disabled={!path || loading} onClick={() => void inspect()} className="mt-2 flex h-7 items-center gap-1.5 rounded bg-surface-2 px-2 text-[10px] text-text-2 hover:text-text-1 disabled:opacity-40">{loading ? <Loader2 size={11} className="animate-spin" /> : <BadgeCheck size={11} />}Inspect</button>
    {error && <p className="mt-1.5 text-[10px] text-error">{error}</p>}
    {info && <dl className="mt-2 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[10px]"><dt className="text-text-4">Organization ID</dt><dd className="text-text-2">{info.organizationIdentifier || 'Not present'}</dd><dt className="text-text-4">PSP roles</dt><dd className="text-text-2">{info.pspRoles.join(', ') || 'Not present'}</dd><dt className="text-text-4">NCA</dt><dd className="text-text-2">{[info.ncaName, info.ncaId].filter(Boolean).join(' · ') || 'Not present'}</dd><dt className="text-text-4">Subject</dt><dd className="truncate text-text-2" title={info.subject}>{info.subject}</dd><dt className="text-text-4">Issuer</dt><dd className="truncate text-text-2" title={info.issuer}>{info.issuer}</dd><dt className="text-text-4">Validity</dt><dd className={info.validNow ? 'text-success' : 'text-error'}>{info.validNow ? 'Valid' : 'Not valid'} · {new Date(info.notAfter).toLocaleDateString()}</dd></dl>}
  </div>
}

export function PSD2RequestPanel({ config = initialConfig, headers, onConfigChange, onHeadersChange, issues = [] }: Props) {
  const [requirements, setRequirements] = useState<{ required: string[]; conditional: string[] } | null>(null)
  const [error, setError] = useState('')
  const patch = (next: Partial<PSD2RequestConfig>) => onConfigChange({ ...config, ...next })
  const build = async () => {
    setError('')
    try {
      const current = Object.fromEntries(headers.filter((item) => item.enabled && item.key).map((item) => [item.key, item.value]))
      const result = await buildPSD2Headers(config.operation, current)
      const existing = new Set(headers.map((item) => item.key.toLowerCase()))
      const additions = result.required.filter((name) => !existing.has(name.toLowerCase())).map((key) => ({ id: uid(), key, value: result.headers[key] ?? '', enabled: true }))
      const generated = result.headers['X-Request-ID']
      const next = headers.map((item) => item.key.toLowerCase() === 'x-request-id' && !item.value ? { ...item, value: generated } : item)
      if (!existing.has('x-request-id') && generated) additions.find((item) => item.key === 'X-Request-ID')!.value = generated
      onHeadersChange([...next, ...additions])
      setRequirements({ required: result.required, conditional: result.conditional })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <section className="bg-surface-0/50 p-3">
    <div className="mb-2 flex items-center gap-2"><ShieldCheck size={14} className="text-accent" /><span className="text-xs font-semibold text-text-1">PSD2 · Berlin Group 1.3.12</span><label className="ml-auto flex items-center gap-1.5 text-[10px] text-text-3"><input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-accent" />Enable for request</label></div>
    {config.enabled && <div className="space-y-2.5">
      {issues.length > 0 && <div role="alert" className="rounded-md border border-error/30 bg-error/10 p-2 text-[10px] text-error"><p className="font-semibold">Complete the PSD2 configuration before sending:</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{issues.map((issue) => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}</ul></div>}
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-text-4">Operation<select value={config.operation} onChange={(e) => patch({ operation: e.target.value as PSD2RequestConfig['operation'] })} className="mt-1 h-7 w-full rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1"><option value="ais-consent">AIS · Create consent</option><option value="pis-payment">PIS · Initiate payment</option><option value="fcs-confirmation">FCS · Funds confirmation</option></select></label><label className="text-[10px] text-text-4">Signature keyId<input value={config.keyId} onChange={(e) => patch({ keyId: e.target.value })} placeholder="Defaults to certificate serial" className="mt-1 h-7 w-full rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1" /></label></div>
      <div className="grid grid-cols-2 gap-2"><CertificateCard label="QWAC · mTLS" path={config.qwacPath} passwordRef={config.qwacPasswordRef} onPath={(qwacPath) => patch({ qwacPath })} onPassword={(qwacPasswordRef) => patch({ qwacPasswordRef })} /><CertificateCard label="QSEAL · request signing" path={config.qsealPath} passwordRef={config.qsealPasswordRef} onPath={(qsealPath) => patch({ qsealPath })} onPassword={(qsealPasswordRef) => patch({ qsealPasswordRef })} /></div>
      <div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-[10px] text-text-3"><input type="checkbox" checked={config.sign} onChange={(e) => patch({ sign: e.target.checked })} className="accent-accent" />Add Digest, Signature and TPP-Signature-Certificate</label><button onClick={() => void build()} className="ml-auto flex h-7 items-center gap-1.5 rounded bg-accent px-2.5 text-[10px] font-medium text-white"><Wand2 size={11} />Build headers</button></div>
      {requirements && <div className="rounded border border-border-2 bg-surface-1 p-2 text-[10px]"><p className="text-text-2">Required: {requirements.required.join(', ')}</p><p className="mt-1 text-text-4">Conditional (add only when applicable): {requirements.conditional.join(', ')}</p></div>}
      {error && <p className="text-[10px] text-error">{error}</p>}
    </div>}
  </section>
}
