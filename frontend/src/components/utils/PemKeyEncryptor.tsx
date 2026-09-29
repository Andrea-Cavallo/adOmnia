import { useState } from 'react'
import { Copy, Download, Loader2, LockKeyhole, UnlockKeyhole } from 'lucide-react'
import { serverUrl, sidecarFetch } from '@/lib/useServerPort'

interface PemKeyEncryptorProps {
  port: number | null
  pem: string
  fileName: string
}

const MIN_PASSWORD = 8

function downloadPem(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Cifra o decifra le chiavi private del PEM in esame, in locale: PKCS#8 cifrato
 * (PBKDF2-SHA256 + AES-256-CBC) che OpenSSL, Java e Go aprono con la stessa password.
 * Certificati e altri blocchi restano invariati; la password non lascia la macchina.
 */
export function PemKeyEncryptor({ port, pem, fileName }: PemKeyEncryptorProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'encrypt' | 'decrypt' | null>(null)
  const [result, setResult] = useState<{ pem: string; keys: number; mode: 'encrypt' | 'decrypt' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const encrypted = pem.includes('BEGIN ENCRYPTED PRIVATE KEY')
  const hasPlainKey = /BEGIN (RSA |EC )?PRIVATE KEY/.test(pem)

  const run = async (mode: 'encrypt' | 'decrypt') => {
    const url = serverUrl(port, '/cert/pem-encrypt')
    if (!url) return setError('Backend not ready yet: retry in a moment.')
    setBusy(mode)
    setError(null)
    setResult(null)
    try {
      const response = await sidecarFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pem, password, mode }) })
      const text = await response.text()
      if (!response.ok) throw new Error(text.trim() || response.statusText)
      const data = JSON.parse(text) as { pem: string; keys: number }
      setResult({ ...data, mode })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const baseName = (fileName || 'key.pem').replace(/\.(pem|key)$/i, '')
  const outputName = result?.mode === 'encrypt' ? `${baseName}.encrypted.pem` : `${baseName}.decrypted.pem`

  return (
    <section aria-label="Encrypt private key" className="flex flex-col gap-2 rounded-lg border border-border-1 bg-surface-1 p-3">
      <div className="flex items-center gap-2">
        <LockKeyhole size={13} className="text-accent" />
        <h3 className="text-xs font-semibold text-text-1">Encrypt / decrypt private key</h3>
        <span className="ml-auto text-[10px] text-text-4">PKCS#8 · PBKDF2-SHA256 · AES-256-CBC · local</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && password) void run(encrypted && !hasPlainKey ? 'decrypt' : 'encrypt') }}
          placeholder={encrypted && !hasPlainKey ? 'Key password' : `New password (min ${MIN_PASSWORD} characters)`}
          autoComplete="new-password"
          className="h-8 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-2 font-mono text-xs text-text-1 outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void run('encrypt')}
          disabled={!!busy || !hasPlainKey || password.length < MIN_PASSWORD}
          title={!hasPlainKey ? 'No unencrypted private key in the PEM above' : password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : 'Encrypt every private key'}
          className="inline-flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-light disabled:opacity-40"
        >
          {busy === 'encrypt' ? <Loader2 size={12} className="animate-spin" /> : <LockKeyhole size={12} />} Encrypt
        </button>
        <button
          type="button"
          onClick={() => void run('decrypt')}
          disabled={!!busy || !encrypted || !password}
          title={encrypted ? 'Decrypt with the key password' : 'No ENCRYPTED PRIVATE KEY in the PEM above'}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-3 text-xs text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
        >
          {busy === 'decrypt' ? <Loader2 size={12} className="animate-spin" /> : <UnlockKeyhole size={12} />} Decrypt
        </button>
      </div>
      {error && <p role="alert" className="rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{error}</p>}
      {result && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-[11px] text-success">
            {result.keys} private key{result.keys === 1 ? '' : 's'} {result.mode === 'encrypt' ? 'encrypted' : 'decrypted'}; other blocks unchanged.
            <button type="button" onClick={() => void navigator.clipboard.writeText(result.pem).catch(() => undefined)} className="ml-auto inline-flex items-center gap-1 rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1"><Copy size={11} /> Copy</button>
            <button type="button" onClick={() => downloadPem(outputName, result.pem)} className="inline-flex items-center gap-1 rounded border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:text-text-1"><Download size={11} /> {outputName}</button>
          </div>
          <pre className="max-h-48 overflow-auto rounded border border-border-1 bg-surface-0 px-3 py-2 font-mono text-[11px] text-text-1">{result.pem}</pre>
        </div>
      )}
    </section>
  )
}
