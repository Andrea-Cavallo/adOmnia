import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, Lock, ShieldCheck, ShieldOff, Upload, Download } from 'lucide-react'
import { useServerPort, serverUrl } from '@/lib/useServerPort'
import { cn } from '@/lib/utils'

export function VaultPanel() {
  const port = useServerPort()
  const importRef = useRef<HTMLInputElement>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [plain, setPlain] = useState('')
  const [cipher, setCipher] = useState('')
  const [exportData, setExportData] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const api = useCallback(async (path: string, body?: unknown) => {
    const url = serverUrl(port, path)
    if (!url) throw new Error('Backend not ready')
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(text || res.statusText)
    return text ? JSON.parse(text) : {}
  }, [port])

  const refresh = useCallback(async () => {
    try {
      const data = await api('/vault/status')
      setUnlocked(Boolean(data.unlocked))
    } catch {
      setUnlocked(false)
    }
  }, [api])

  useEffect(() => {
    if (port) refresh()
  }, [port, refresh])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('adomnia.vault.pendingSecret')
      if (!raw) return
      const pending = JSON.parse(raw) as { name?: string; value?: string; note?: string }
      if (pending.value) {
        setPlain(JSON.stringify({
          name: pending.name ?? 'Imported secret',
          value: pending.value,
          note: pending.note ?? 'Imported from another adOmnia panel',
        }, null, 2))
        setMessage('Secret loaded from another panel. Enter a passphrase and encrypt it here.')
        localStorage.removeItem('adomnia.vault.pendingSecret')
      }
    } catch { /* ignore pending secret parse errors */ }
  }, [])

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    }
  }

  const unlock = () => run(async () => {
    await api('/vault/unlock', { passphrase })
    setMessage('Vault unlocked successfully')
    refresh()
  })

  const lock = () => run(async () => {
    await api('/vault/lock', {})
    setMessage('Vault locked')
    refresh()
  })

  const encrypt = () => run(async () => {
    const data = await api('/vault/encrypt', { plaintext: plain, passphrase })
    setCipher(data.ciphertext ?? '')
    setMessage('Encrypted')
  })

  const decrypt = () => run(async () => {
    const data = await api('/vault/decrypt', { ciphertext: cipher, passphrase })
    setPlain(data.plaintext ?? '')
    setMessage('Decrypted')
  })

  const exportVault = () => run(async () => {
    const data = await api('/vault/export', { passphrase })
    const text = JSON.stringify(data, null, 2)
    setExportData(text)
    await navigator.clipboard.writeText(text)
    setMessage('Encrypted workspace export copied to clipboard')
  })

  const importVault = (file?: File) => run(async () => {
    if (!file) return
    const parsed = JSON.parse(await file.text())
    const data = await api('/vault/import', { data: parsed.data ?? parsed, passphrase })
    setMessage(`Imported ${data.imported ?? 0} entries`)
  })

  return (
    <div className="flex-1 flex flex-col overflow-auto p-5 gap-5 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
            <KeyRound size={15} className="text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-1 leading-none">Vault</h2>
            <p className="text-[10px] text-text-4 mt-0.5">age/scrypt local encryption</p>
          </div>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border',
          unlocked
            ? 'bg-success/10 text-success border-success/25'
            : 'bg-surface-2 text-text-4 border-border-2',
        )}>
          {unlocked ? <ShieldCheck size={10} /> : <ShieldOff size={10} />}
          {unlocked ? 'Unlocked' : 'Locked'}
        </div>
        <div className="flex-1" />
        {unlocked ? (
          <button
            onClick={lock}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-error/80 hover:bg-error text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Lock size={12} /> Lock Vault
          </button>
        ) : (
          <button
            onClick={unlock}
            disabled={!passphrase}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-medium shadow-[0_0_16px_var(--color-accent-glow)] hover:shadow-accent/30 transition-all disabled:opacity-40 disabled:shadow-none"
          >
            <KeyRound size={12} /> Unlock Vault
          </button>
        )}
      </div>

      {/* Feedback banner */}
      {(message || error) && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs',
          error
            ? 'bg-error/8 border-error/25 text-error'
            : 'bg-success/8 border-success/25 text-success',
        )}>
          {error || message}
        </div>
      )}

      {/* Passphrase */}
      <div className="bg-surface-1 border border-border-2 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Passphrase</span>
        </div>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !unlocked && passphrase) unlock() }}
          placeholder="Enter your vault passphrase…"
          className="w-full h-9 px-3 bg-surface-2 border border-border-2 rounded-lg text-sm text-text-1 outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 placeholder:text-text-4 transition-all"
        />
        <p className="text-[10px] text-text-4">
          The passphrase is used locally for age/scrypt encryption. Plaintext typed here is only in memory until you encrypt or clear it; workspace export stores encrypted bbolt data.
        </p>
      </div>

      {/* Encrypt / Decrypt */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="bg-surface-1 border border-border-2 rounded-xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">Plaintext</span>
            <button
              onClick={encrypt}
              disabled={!plain || !passphrase}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-md text-[10px] font-semibold disabled:opacity-40 transition-colors"
            >
              Encrypt →
            </button>
          </div>
          <textarea
            value={plain}
            onChange={(e) => setPlain(e.target.value)}
            className="flex-1 p-4 bg-transparent text-xs text-text-1 font-mono resize-none outline-none min-h-[240px]"
            placeholder="Paste plaintext here…"
          />
        </div>

        <div className="bg-surface-1 border border-border-2 rounded-xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">Ciphertext</span>
            <button
              onClick={decrypt}
              disabled={!cipher || !passphrase}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/25 rounded-md text-[10px] font-semibold disabled:opacity-40 transition-colors"
            >
              ← Decrypt
            </button>
          </div>
          <textarea
            value={cipher}
            onChange={(e) => setCipher(e.target.value)}
            className="flex-1 p-4 bg-transparent text-xs text-text-1 font-mono resize-none outline-none min-h-[240px]"
            placeholder="Paste ciphertext here…"
          />
        </div>
      </div>

      {/* Workspace Import / Export */}
      <div className="bg-surface-1 border border-border-2 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 flex-1">
            Encrypted Workspace
          </span>
          <button
            onClick={exportVault}
            disabled={!passphrase}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border-2 rounded-md text-xs text-text-3 hover:text-text-1 hover:border-border-1 disabled:opacity-40 transition-colors"
          >
            <Download size={11} /> Export &amp; Copy
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={!passphrase}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border-2 rounded-md text-xs text-text-3 hover:text-text-1 hover:border-border-1 disabled:opacity-40 transition-colors"
          >
            <Upload size={11} /> Import File
          </button>
          <input ref={importRef} type="file" accept=".json,.adomnia-age" className="hidden" onChange={(e) => importVault(e.target.files?.[0])} />
        </div>
        <textarea
          value={exportData}
          onChange={(e) => setExportData(e.target.value)}
          rows={5}
          className="w-full p-4 bg-surface-0 text-[10px] text-text-2 font-mono resize-none outline-none"
          placeholder="Encrypted workspace export appears here and is copied to clipboard automatically…"
        />
      </div>
    </div>
  )
}
