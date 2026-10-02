import { useEffect, useState } from 'react'
import { KeyRound, PlugZap } from 'lucide-react'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { ModuleRegistryCheck, PrivateRepoCredential } from '../../../bindings/adomnia/internal/goide/models'
import { GoStudioButton, GoStudioField } from './GoStudioModal'
import { privateHostsOf, usesGitCredentials, withGoAuth, type ToolchainForm } from './goStudioToolchainEnv'

interface Props {
  sessionId: string
  form: ToolchainForm
  onChange: (form: ToolchainForm) => void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Credenziali dei repository privati e prova del registry interno. adOmnia non salva i token:
 * li affida al gestore credenziali di Git, da cui li leggono git e `go` (GOAUTH=git).
 */
export function GoStudioPrivateModules({ sessionId, form, onChange }: Props) {
  const hosts = privateHostsOf(form)
  const [status, setStatus] = useState<Record<string, PrivateRepoCredential>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [registry, setRegistry] = useState<ModuleRegistryCheck | null>(null)
  const [testing, setTesting] = useState(false)
  const hostKey = hosts.join(',')

  useEffect(() => {
    for (const host of hostKey ? hostKey.split(',') : []) {
      GoIDEBindings.PrivateRepoCredentialStatus(host).then((result) => setStatus((current) => ({ ...current, [host]: result }))).catch(() => undefined)
    }
  }, [hostKey])

  const save = async (host: string) => {
    setMessage(null)
    try {
      const result = await GoIDEBindings.SavePrivateRepoCredential(host, username, token)
      setStatus((current) => ({ ...current, [host]: result }))
      setEditing(null); setUsername(''); setToken('')
    } catch (error) { setMessage(errorText(error)) }
  }
  const remove = async (host: string) => {
    setMessage(null)
    try {
      await GoIDEBindings.RemovePrivateRepoCredential(host)
      setStatus((current) => ({ ...current, [host]: { host, stored: false } }))
    } catch (error) { setMessage(errorText(error)) }
  }
  const toggleGoAuth = async () => onChange(withGoAuth(form, usesGitCredentials(form) ? null : await GoIDEBindings.GoAuthWithGitCredentials()))
  const testRegistry = async () => {
    setTesting(true); setRegistry(null)
    try { setRegistry(await GoIDEBindings.TestModuleRegistry(sessionId)) } catch (error) { setRegistry({ url: '', module: '', ok: false, message: errorText(error) }) } finally { setTesting(false) }
  }

  return (
    <GoStudioField label="Private modules and registry" hint="Tokens go to the Git credential manager (Windows Credential Manager, Keychain, libsecret), never to adOmnia files. git uses them directly; go uses them through GOAUTH.">
      <div className="flex flex-col gap-1.5">
        {hosts.length === 0 && <span className="text-[11.5px] text-text-4">Set GOPRIVATE or an internal GOPROXY to manage credentials here.</span>}
        {hosts.map((host) => {
          const current = status[host]
          return (
            <div key={host} className="flex flex-col gap-1.5 rounded border border-border-1 px-2 py-1.5">
              <div className="flex items-center gap-2 text-[12px]">
                <KeyRound size={12} className={current?.stored ? 'text-status-ok' : 'text-text-4'} />
                <span className="gs-mono text-text-1">{host}</span>
                <span className="text-text-4">{current ? (current.stored ? `signed in as ${current.username || '—'}` : 'no credentials') : 'checking…'}</span>
                <span className="ml-auto flex gap-1">
                  <GoStudioButton small variant="ghost" onClick={() => { setEditing(editing === host ? null : host); setMessage(null) }}>{current?.stored ? 'Replace' : 'Add'}</GoStudioButton>
                  {current?.stored && <GoStudioButton small variant="ghost" onClick={() => void remove(host)}>Remove</GoStudioButton>}
                </span>
              </div>
              {editing === host && (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                  <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" autoComplete="off" className="gs-input" />
                  <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token or password" type="password" autoComplete="off" className="gs-input" />
                  <GoStudioButton small variant="primary" disabled={!username.trim() || !token.trim()} onClick={() => void save(host)}>Save</GoStudioButton>
                </div>
              )}
            </div>
          )
        })}
        {message && <span role="alert" className="text-[11.5px] text-danger">{message}</span>}
        <label className="flex items-center gap-2 text-[12px] text-text-2">
          <input type="checkbox" checked={usesGitCredentials(form)} onChange={() => void toggleGoAuth()} />
          Let go read registry credentials from Git (GOAUTH, Go 1.24+)
        </label>
        <div className="flex items-center gap-2">
          <GoStudioButton small icon={PlugZap} loading={testing} onClick={() => void testRegistry()}>Test module registry</GoStudioButton>
          <span role="status" aria-live="polite" className={`text-[11.5px] ${registry ? (registry.ok ? 'text-status-ok' : 'text-danger') : 'text-text-4'}`}>
            {registry ? registry.message : 'Uses the saved GOPROXY with adOmnia proxy, CA and Git credentials.'}
          </span>
        </div>
      </div>
    </GoStudioField>
  )
}
