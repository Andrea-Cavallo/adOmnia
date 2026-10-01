import { useEffect, useState } from 'react'
import { AlertCircle, Copy, ExternalLink, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'
import { getCopilotLog, type CopilotSettings } from '@/lib/copilot-api'
import { State } from '../../../bindings/adomnia/internal/copilot/models'
import { useCopilotStore } from '@/stores/copilot'
import { GoStudioCopilotProfiles } from './GoStudioCopilotProfiles'
import { copilotAccountLabel, copilotPresentation } from './GoStudioCopilotStatus'

const BUTTON = 'gs-btn gs-btn-secondary gs-btn-sm'

interface GoStudioCopilotDialogProps {
  projectRoot: string | null
  projectName: string | null
}

function SignInPanel() {
  const prompt = useCopilotStore((state) => state.signIn)
  const clearSignIn = useCopilotStore((state) => state.clearSignIn)
  if (!prompt) return null
  return (
    <div role="status" className="gs-alert gs-tone-accent flex-col">
      <p className="text-[12.5px] text-text-2">Enter this code on <span className="font-mono text-text-1">{prompt.host}</span> to authorize adOmnia. It is already in your clipboard.</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="gs-mono rounded-lg bg-surface-0 px-3 py-1.5 text-lg font-semibold tracking-[0.2em] text-text-1">{prompt.userCode}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(prompt.userCode ?? '')} className={BUTTON}><Copy size={12} /> Copy</button>
        {prompt.verificationUri && <button type="button" onClick={() => void Browser.OpenURL(prompt.verificationUri ?? '')} className={BUTTON}><ExternalLink size={12} /> Open {new URL(prompt.verificationUri).host}</button>}
        <GoStudioButton small variant="ghost" className="ml-auto" onClick={clearSignIn}>Cancel</GoStudioButton>
      </div>
      <p className="flex items-center gap-1.5 text-[12px] text-text-3"><Loader2 size={11} className="animate-spin" /> Waiting for GitHub to confirm the sign-in…</p>
    </div>
  )
}

function ServerSection() {
  const status = useCopilotStore((state) => state.status)
  const install = useCopilotStore((state) => state.install)
  const busy = useCopilotStore((state) => state.busy)
  const { installServer, restart } = useCopilotStore.getState()
  const [log, setLog] = useState<string[] | null>(null)
  const percent = install && install.total > 0 ? Math.round((install.downloaded * 100) / install.total) : null
  const binary = status?.binary
  const installed = !!binary?.path
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="gs-section-title">Language server</h3>
      <p className="text-[12.5px] text-text-2">
        {installed ? <>GitHub Copilot Language Server {status?.serverVersion || binary?.version} <span className="text-text-4">({binary?.source})</span></> : 'Not installed. adOmnia downloads the official binary from npm and checks its SHA-512 integrity.'}
      </p>
      {status?.state === State.StateInstalling && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent ?? 5}%` }} /></div>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy || status?.state === State.StateInstalling} onClick={() => void installServer()} className={BUTTON}>{installed ? 'Update' : 'Install'}</button>
        {installed && <button type="button" disabled={busy} onClick={() => void restart()} className={BUTTON}>Restart</button>}
        <button type="button" onClick={() => void getCopilotLog().then(setLog)} className={BUTTON}>Show logs</button>
      </div>
      {log && <pre className="gs-surface gs-mono max-h-44 overflow-auto p-3 text-[11px] leading-5 text-text-3">{log.length ? log.join('\n') : 'No log lines yet.'}</pre>}
    </section>
  )
}

/** Impostazioni di GitHub Copilot in gO Studio: account (anche Enterprise), progetto, rete, server. */
export function GoStudioCopilotDialog({ projectRoot, projectName }: GoStudioCopilotDialogProps) {
  const open = useCopilotStore((state) => state.dialogOpen)
  const settings = useCopilotStore((state) => state.settings)
  const status = useCopilotStore((state) => state.status)
  const busy = useCopilotStore((state) => state.busy)
  const error = useCopilotStore((state) => state.error)
  const { setDialogOpen, saveSettings, startSignIn, signOut } = useCopilotStore.getState()
  const [draft, setDraft] = useState<CopilotSettings | null>(null)
  const close = () => setDialogOpen(false)

  useEffect(() => {
    if (open && settings) setDraft(structuredClone(settings))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !draft) return null
  const view = copilotPresentation(status, null)
  const signedIn = status?.state === State.StateReady || status?.state === State.StateUnauthorized

  const save = async () => {
    if (await saveSettings(draft)) close()
  }

  return (
    <GoStudioModal
      open={open}
      onClose={close}
      size="md"
      divided
      icon={Sparkles}
      title="GitHub Copilot"
      subtitle={<span className={view.tone}>{status?.message || view.label}</span>}
      actions={<label className="gs-check mr-1 text-[12.5px]"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Enabled</label>}
      footer={<>
        <GoStudioButton variant="ghost" onClick={close}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" loading={busy} onClick={() => void save()}>Save</GoStudioButton>
      </>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}

      <section className="flex flex-col gap-2.5">
        <h3 className="gs-section-title">Account</h3>
        <div className="gs-surface flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-text-1">{copilotAccountLabel(status)}</p>
            <p className="text-[11.5px] text-text-4">{status?.profile?.type && status.profile.type !== 'github.com' ? 'GitHub Copilot Enterprise' : 'GitHub Copilot'}{signedIn ? '' : ' · not signed in'}</p>
          </div>
          {settings?.enabled && (signedIn
            ? <GoStudioButton small variant="secondary" className="ml-auto" disabled={busy} onClick={() => void signOut()}>Sign out</GoStudioButton>
            : <GoStudioButton small variant="primary" className="ml-auto" disabled={busy || status?.state !== State.StateSignedOut} onClick={() => void startSignIn()}>Sign in…</GoStudioButton>)}
        </div>
        <SignInPanel />
        <label className="gs-check">
          <input type="checkbox" checked={draft.inlineCompletion} onChange={(event) => setDraft({ ...draft, inlineCompletion: event.target.checked })} />
          Inline completions: <span className="gs-kbd">Tab</span> accepts, <span className="gs-kbd">Esc</span> dismisses
        </label>
      </section>

      <GoStudioCopilotProfiles draft={draft} onChange={setDraft} projectRoot={projectRoot} projectName={projectName} />
      <ServerSection />

      <GoStudioAlert tone="info" icon={ShieldCheck}>
        Your workspace stays local. Copilot receives the open file and nearby code, sent to the GitHub host of the selected account.
        {' '}<span className="gs-mono">.env</span>, keys, certificates and paths in <span className="gs-mono">.adomnia/aiignore</span> are never sent.
        adOmnia has no telemetry and Copilot telemetry is off. Your GitHub token stays in the Copilot language server’s own store.
      </GoStudioAlert>
    </GoStudioModal>
  )
}
