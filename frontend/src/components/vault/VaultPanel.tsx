import '@/styles/studioNothing.css'
import './vault.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Clipboard, KeyRound, Lock, ShieldCheck, ShieldOff, Upload, Download } from 'lucide-react'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
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
    const res = await sidecarFetch(url, {
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
    if (!port) return
    let cancelled = false
    api('/vault/status')
      .then((data) => { if (!cancelled) setUnlocked(Boolean(data.unlocked)) })
      .catch(() => { if (!cancelled) setUnlocked(false) })
    return () => { cancelled = true }
  }, [port, api])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('adomnia.vault.pendingSecret')
      if (!raw) return
      const pending = JSON.parse(raw) as { name?: string; value?: string; note?: string }
      if (pending.value) {
        const loaded = JSON.stringify({
          name: pending.name ?? 'Imported secret',
          value: pending.value,
          note: pending.note ?? 'Imported from another adOmnia panel',
        }, null, 2)
        // Deferred so the hand-off does not set state synchronously inside the effect.
        queueMicrotask(() => {
          setPlain(loaded)
          setMessage('Secret loaded from another panel. Enter a passphrase and encrypt it here.')
        })
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
    void refresh()
  })

  const lock = () => run(async () => {
    await api('/vault/lock', {})
    setMessage('Vault locked')
    void refresh()
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

  const copyEnvRef = () => run(async () => {
    if (!cipher) return
    await navigator.clipboard.writeText(`vault:${cipher}`)
    setMessage('Vault environment reference copied')
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
    <div className="nothing-studio vault-root">
      <div className="vault-workbench">
        <header className="vault-heading">
          <div><h2 className="nothing-studio-title">Vault</h2><p>Local encryption · age / scrypt</p></div>
          <span role="status" className={cn('vault-status', unlocked && 'is-unlocked')}>
            {unlocked ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
            {unlocked ? 'Unlocked' : 'Locked'}
          </span>
        </header>

        <section className="vault-access" aria-label="Vault access">
          <div className="vault-passphrase-row">
            <label htmlFor="vault-passphrase">Passphrase
              <input id="vault-passphrase" type="password" value={passphrase} onChange={event => setPassphrase(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !unlocked && passphrase) void unlock() }} placeholder="Enter your vault passphrase" autoComplete="off" className="vault-input" />
            </label>
            {unlocked
              ? <button type="button" onClick={lock} className="vault-button"><Lock size={14} /> Lock Vault</button>
              : <button type="button" onClick={unlock} disabled={!passphrase} className="vault-button vault-button-primary"><KeyRound size={14} /> Unlock Vault</button>}
          </div>
          <p>The passphrase is used locally for age/scrypt encryption. Plaintext stays in memory until you encrypt or clear it; workspace exports contain encrypted data.</p>
        </section>

        {(message || error) && <div role={error ? 'alert' : 'status'} className={cn('vault-feedback', error ? 'is-error' : 'is-success')}>{error || message}</div>}

        <div className="vault-editors">
          <section className="vault-pane" aria-label="Encrypt a value">
            <header className="vault-pane-heading"><div><h3>Plaintext</h3><p>Value to encrypt</p></div>
              <button type="button" onClick={encrypt} disabled={!plain || !passphrase} className="vault-button vault-button-primary"><Lock size={13} /> Encrypt</button>
            </header>
            <textarea aria-label="Plaintext value" value={plain} onChange={event => setPlain(event.target.value)} className="vault-editor" placeholder="Paste plaintext here…" spellCheck={false} />
          </section>
          <section className="vault-pane" aria-label="Decrypt a value">
            <header className="vault-pane-heading"><div><h3>Ciphertext</h3><p>Encrypted payload</p></div><div className="vault-pane-actions">
              <button type="button" onClick={copyEnvRef} disabled={!cipher} className="vault-button" title="Copy the encrypted value with its vault: prefix"><Clipboard size={13} /> Copy ref</button>
              <button type="button" onClick={decrypt} disabled={!cipher || !passphrase} className="vault-button"><KeyRound size={13} /> Decrypt</button>
            </div></header>
            <textarea aria-label="Encrypted value" value={cipher} onChange={event => setCipher(event.target.value)} className="vault-editor" placeholder="Encrypted value appears here…" spellCheck={false} />
          </section>
        </div>

        <details className="vault-transfer">
          <summary>Workspace import / export</summary>
          <div className="vault-transfer-heading"><p>Move encrypted workspace data as a file.</p><div className="vault-pane-actions">
            <button type="button" onClick={exportVault} disabled={!passphrase} className="vault-button"><Download size={14} /> Export &amp; Copy</button>
            <button type="button" onClick={() => importRef.current?.click()} disabled={!passphrase} className="vault-button"><Upload size={14} /> Import File</button>
          </div></div>
          <input ref={importRef} type="file" accept=".json,.adomnia-age" className="hidden" aria-label="Import encrypted workspace file" onChange={event => { void importVault(event.target.files?.[0]) }} />
          <textarea aria-label="Encrypted workspace export" value={exportData} onChange={event => setExportData(event.target.value)} rows={5} className="vault-editor vault-export" placeholder="Encrypted workspace export appears here and is copied to the clipboard…" spellCheck={false} />
        </details>
      </div>
    </div>
  )
}
