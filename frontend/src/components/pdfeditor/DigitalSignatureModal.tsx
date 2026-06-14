import { useState } from 'react'
import { Check, X, ShieldCheck, Upload, Search, Loader2, KeyRound } from 'lucide-react'
import {
  inspectSigningCertificate,
  type PdfCredentialSource,
  type PdfKeystoreType,
  type PdfSigningCertificateInfo,
} from '@/lib/pdf/pdfSigning'

const TSA_URL_STORAGE_KEY = 'adomnia.pdf.tsaUrl'

export interface DigitalSignatureForm {
  credentialSource: PdfCredentialSource
  certificatePem: string
  privateKeyPem: string
  keystoreBase64?: string
  keystoreType?: PdfKeystoreType
  keystorePassword?: string
  tsaUrl?: string
  tsaUsername?: string
  tsaPassword?: string
  enableLtv?: boolean
  name: string
  location: string
  reason: string
  contactInfo: string
  visible: boolean
}

interface Props {
  defaultName: string
  onClose: () => void
  onSign: (form: DigitalSignatureForm) => void
}

function detectKeystoreType(fileName: string): PdfKeystoreType {
  return /\.jks$/i.test(fileName) ? 'jks' : 'p12'
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const inputClass =
  'h-8 rounded-md border border-border-2 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent'
const labelClass = 'grid gap-1 text-[11px] font-medium text-text-3'

export function DigitalSignatureModal({ defaultName, onClose, onSign }: Props) {
  const [form, setForm] = useState<DigitalSignatureForm>(() => ({
    credentialSource: 'pem',
    certificatePem: '',
    privateKeyPem: '',
    keystoreBase64: '',
    keystoreType: 'p12',
    keystorePassword: '',
    tsaUrl: localStorage.getItem(TSA_URL_STORAGE_KEY) ?? '',
    tsaUsername: '',
    tsaPassword: '',
    enableLtv: false,
    name: defaultName,
    location: '',
    reason: 'Document approval',
    contactInfo: '',
    visible: true,
  }))
  const [keystoreName, setKeystoreName] = useState('')
  const [rememberTsa, setRememberTsa] = useState(() => !!localStorage.getItem(TSA_URL_STORAGE_KEY))
  const [inspecting, setInspecting] = useState(false)
  const [certInfo, setCertInfo] = useState<PdfSigningCertificateInfo | null>(null)
  const [inspectError, setInspectError] = useState('')

  const patch = (next: Partial<DigitalSignatureForm>) => {
    setForm((prev) => ({ ...prev, ...next }))
    setCertInfo(null)
    setInspectError('')
  }

  const credentialReady =
    form.credentialSource === 'pem'
      ? form.certificatePem.includes('BEGIN CERTIFICATE') && form.privateKeyPem.includes('PRIVATE KEY')
      : !!form.keystoreBase64 && !!form.keystorePassword

  const onPickKeystore = async (file: File | undefined) => {
    if (!file) return
    try {
      const b64 = await fileToBase64(file)
      setKeystoreName(file.name)
      patch({ keystoreBase64: b64, keystoreType: detectKeystoreType(file.name) })
    } catch {
      setInspectError('Could not read keystore file.')
    }
  }

  const onInspect = async () => {
    setInspecting(true)
    setInspectError('')
    setCertInfo(null)
    try {
      const info = await inspectSigningCertificate({
        credentialSource: form.credentialSource,
        certificatePem: form.certificatePem,
        privateKeyPem: form.privateKeyPem,
        keystoreBase64: form.keystoreBase64,
        keystorePassword: form.keystorePassword,
        keystoreType: form.keystoreType,
      })
      setCertInfo(info)
    } catch (e: unknown) {
      setInspectError(e instanceof Error ? e.message : 'Inspection failed')
    } finally {
      setInspecting(false)
    }
  }

  const handleSign = () => {
    const tsaUrl = (form.tsaUrl ?? '').trim()
    if (rememberTsa && tsaUrl) localStorage.setItem(TSA_URL_STORAGE_KEY, tsaUrl)
    else if (!rememberTsa) localStorage.removeItem(TSA_URL_STORAGE_KEY)
    onSign(form)
  }

  return (
    <div className="fixed inset-0 z-[210] grid place-items-center bg-black/55 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border-2 bg-surface-1 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
          <ShieldCheck size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-1">Cryptographic PDF signature</h2>
          <button onClick={onClose} className="ml-auto grid h-7 w-7 place-items-center rounded-md text-text-4 hover:bg-surface-2 hover:text-text-1">
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Name
              <input value={form.name} onChange={(e) => patch({ name: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Location
              <input value={form.location} onChange={(e) => patch({ location: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Reason
              <input value={form.reason} onChange={(e) => patch({ reason: e.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Contact
              <input value={form.contactInfo} onChange={(e) => patch({ contactInfo: e.target.value })} className={inputClass} />
            </label>
          </div>

          {/* Credential source */}
          <div className="grid gap-2 rounded-md border border-border-1 bg-surface-0/40 p-3">
            <div className="flex items-center gap-2">
              <KeyRound size={13} className="text-text-3" />
              <span className="text-[11px] font-semibold text-text-2">Signing credential</span>
              <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border-2 text-[11px]">
                {(['pem', 'keystore'] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => patch({ credentialSource: src })}
                    className={`px-2.5 py-1 ${form.credentialSource === src ? 'bg-accent text-white' : 'text-text-3 hover:bg-surface-2'}`}
                  >
                    {src === 'pem' ? 'PEM' : 'P12 / JKS'}
                  </button>
                ))}
              </div>
            </div>

            {form.credentialSource === 'pem' ? (
              <>
                <label className={labelClass}>
                  Certificate PEM
                  <textarea value={form.certificatePem} onChange={(e) => patch({ certificatePem: e.target.value })} rows={4} spellCheck={false} className="resize-none rounded-md border border-border-2 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" placeholder="-----BEGIN CERTIFICATE-----" />
                </label>
                <label className={labelClass}>
                  Private key PEM
                  <textarea value={form.privateKeyPem} onChange={(e) => patch({ privateKeyPem: e.target.value })} rows={4} spellCheck={false} className="resize-none rounded-md border border-border-2 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" placeholder="-----BEGIN PRIVATE KEY-----" />
                </label>
              </>
            ) : (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-2 bg-surface-0 px-2.5 text-xs text-text-2 hover:text-text-1">
                    <Upload size={13} />
                    {keystoreName || 'Choose .p12 / .pfx / .jks'}
                    <input type="file" accept=".p12,.pfx,.jks" className="hidden" onChange={(e) => void onPickKeystore(e.target.files?.[0])} />
                  </label>
                  <select value={form.keystoreType} onChange={(e) => patch({ keystoreType: e.target.value as PdfKeystoreType })} className={inputClass}>
                    <option value="p12">PKCS#12</option>
                    <option value="jks">JKS</option>
                  </select>
                </div>
                <label className={labelClass}>
                  Keystore password
                  <input type="password" value={form.keystorePassword} onChange={(e) => patch({ keystorePassword: e.target.value })} className={inputClass} placeholder="••••••••" />
                </label>
                <p className="text-[10px] text-text-4">The private key is extracted in the backend and never leaves your machine.</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void onInspect()}
                disabled={!credentialReady || inspecting}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11px] text-text-2 hover:text-text-1 disabled:opacity-40"
              >
                {inspecting ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Inspect certificate
              </button>
              {inspectError && <span className="text-[10px] text-error">{inspectError}</span>}
            </div>

            {certInfo && (
              <div className="grid gap-0.5 rounded-md border border-border-1 bg-surface-1 p-2 text-[10px] text-text-3">
                <div><span className="text-text-4">Subject:</span> {certInfo.subject}</div>
                <div><span className="text-text-4">Issuer:</span> {certInfo.issuer}</div>
                <div><span className="text-text-4">Valid:</span> {certInfo.notBefore} → {certInfo.notAfter}</div>
                <div><span className="text-text-4">Chain:</span> {certInfo.chainLength} cert(s) · key present: {certInfo.hasPrivateKey ? 'yes' : 'no'}</div>
              </div>
            )}
          </div>

          {/* TSA */}
          <div className="grid gap-2 rounded-md border border-border-1 bg-surface-0/40 p-3">
            <span className="text-[11px] font-semibold text-text-2">Timestamp (RFC 3161) — optional</span>
            <label className={labelClass}>
              TSA URL
              <input value={form.tsaUrl} onChange={(e) => patch({ tsaUrl: e.target.value })} className={inputClass} placeholder="https://timestamp.example.com" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelClass}>
                TSA user (optional)
                <input value={form.tsaUsername} onChange={(e) => patch({ tsaUsername: e.target.value })} className={inputClass} />
              </label>
              <label className={labelClass}>
                TSA password (optional)
                <input type="password" value={form.tsaPassword} onChange={(e) => patch({ tsaPassword: e.target.value })} className={inputClass} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-text-3">
              <input type="checkbox" checked={rememberTsa} onChange={(e) => setRememberTsa(e.target.checked)} />
              Remember TSA URL (credentials are never stored)
            </label>
          </div>

          {/* LTV + visible */}
          <label className="flex items-start gap-2 rounded-md border border-border-1 bg-surface-0/40 p-3 text-[11px] text-text-3">
            <input type="checkbox" className="mt-0.5" checked={!!form.enableLtv} onChange={(e) => patch({ enableLtv: e.target.checked })} />
            <span>
              <span className="font-semibold text-text-2">Embed long-term validation (LTV)</span>
              <br />Adds the certificate chain plus OCSP/CRL revocation data to the document DSS. Requires reachable revocation endpoints and (for full LTV) a TSA timestamp.
            </span>
          </label>

          <label className="flex items-center gap-2 text-[11px] text-text-3">
            <input type="checkbox" checked={form.visible} onChange={(e) => patch({ visible: e.target.checked })} />
            Add a visible signature box on the active page
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-1 px-4 py-3">
          <button onClick={onClose} className="h-8 rounded-md border border-border-2 px-3 text-xs text-text-2 hover:text-text-1">Cancel</button>
          <button onClick={handleSign} disabled={!credentialReady} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
            <Check size={14} /> Sign PDF
          </button>
        </div>
      </div>
    </div>
  )
}
