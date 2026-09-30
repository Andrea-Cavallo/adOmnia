import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Loader2, X } from 'lucide-react'
import { Browser } from '@wailsio/runtime'
import { useModalFocusTrap } from '@/lib/accessibility'
import { getCopilotLog, type CopilotSettings } from '@/lib/copilot-api'
import { State } from '../../../bindings/adomnia/internal/copilot/models'
import { useCopilotStore } from '@/stores/copilot'
import { GoStudioCopilotProfiles } from './GoStudioCopilotProfiles'
import { copilotAccountLabel, copilotPresentation } from './GoStudioCopilotStatus'

const BUTTON = 'flex h-7 items-center gap-1.5 rounded border border-border-2 bg-surface-2 px-2.5 text-[11px] text-text-2 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40'

interface GoStudioCopilotDialogProps {
  projectRoot: string | null
  projectName: string | null
}

function SignInPanel() {
  const prompt = useCopilotStore((state) => state.signIn)
  const clearSignIn = useCopilotStore((state) => state.clearSignIn)
  if (!prompt) return null
  return (
    <div role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-3">
      <p className="text-[11px] text-text-2">Enter this code on <span className="font-mono text-text-1">{prompt.host}</span> to authorize adOmnia. It is already in your clipboard.</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-surface-0 px-3 py-1.5 font-mono text-lg font-semibold tracking-[0.2em] text-text-1">{prompt.userCode}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(prompt.userCode ?? '')} className={BUTTON}><Copy size={12} /> Copy</button>
        {prompt.verificationUri && <button type="button" onClick={() => void Browser.OpenURL(prompt.verificationUri ?? '')} className={BUTTON}><ExternalLink size={12} /> Open {new URL(prompt.verificationUri).host}</button>}
        <button type="button" onClick={clearSignIn} className="ml-auto text-[10.5px] text-text-4 hover:text-text-2">Cancel</button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-text-3"><Loader2 size={11} className="animate-spin" /> Waiting for GitHub to confirm the sign-in…</p>
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
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Language server</h3>
      <p className="text-[11px] text-text-2">
        {installed ? <>GitHub Copilot Language Server {status?.serverVersion || binary?.version} <span className="text-text-4">({binary?.source})</span></> : 'Not installed. adOmnia downloads the official binary from npm and checks its SHA-512 integrity.'}
      </p>
      {status?.state === State.StateInstalling && (
        <div className="h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent ?? 5}%` }} /></div>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy || status?.state === State.StateInstalling} onClick={() => void installServer()} className={BUTTON}>{installed ? 'Update' : 'Install'}</button>
        {installed && <button type="button" disabled={busy} onClick={() => void restart()} className={BUTTON}>Restart</button>}
        <button type="button" onClick={() => void getCopilotLog().then(setLog)} className={BUTTON}>Show logs</button>
      </div>
      {log && <pre className="max-h-40 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] leading-4 text-text-3">{log.length ? log.join('\n') : 'No log lines yet.'}</pre>}
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = () => setDialogOpen(false)
  useModalFocusTrap(open, close, dialogRef)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="GitHub Copilot" tabIndex={-1} className="flex max-h-[88vh] w-[620px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">GitHub Copilot</h2>
          <span className={`text-[11px] ${view.tone}`}>{status?.message || view.label}</span>
          <label className="ml-auto flex items-center gap-2 text-[11px] text-text-2">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="accent-[var(--color-accent)]" /> Enabled
          </label>
          <button type="button" onClick={close} aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {error && <div role="alert" className="rounded border border-danger/30 bg-danger/10 p-2 text-[10.5px] text-danger">{error}</div>}

          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Account</h3>
            <div className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-text-1">{copilotAccountLabel(status)}</p>
                <p className="text-[10px] text-text-4">{status?.profile?.type && status.profile.type !== 'github.com' ? 'GitHub Copilot Enterprise' : 'GitHub Copilot'}{signedIn ? '' : ' · not signed in'}</p>
              </div>
              {settings?.enabled && (signedIn
                ? <button type="button" disabled={busy} onClick={() => void signOut()} className={`${BUTTON} ml-auto`}>Sign out</button>
                : <button type="button" disabled={busy || status?.state !== State.StateSignedOut} onClick={() => void startSignIn()} className={`${BUTTON} ml-auto`}>Sign in…</button>)}
            </div>
            <SignInPanel />
            <label className="flex items-center gap-2 text-[11px] text-text-2">
              <input type="checkbox" checked={draft.inlineCompletion} onChange={(event) => setDraft({ ...draft, inlineCompletion: event.target.checked })} className="accent-[var(--color-accent)]" />
              Inline completions (ghost text): Tab accepts, Esc dismisses
            </label>
          </section>

          <GoStudioCopilotProfiles draft={draft} onChange={setDraft} projectRoot={projectRoot} projectName={projectName} />
          <ServerSection />

          <p className="rounded border border-border-1 bg-surface-0 p-2.5 text-[10px] leading-4 text-text-3">
            Your workspace is stored locally. AI features send selected context (the open file and nearby code) to the GitHub host of the selected account.
            {' '}<span className="font-mono">.env</span>, keys, certificates and paths in <span className="font-mono">.adomnia/aiignore</span> are never sent.
            adOmnia has no telemetry; Copilot telemetry is set to off. Your GitHub token stays in the Copilot language server’s own credential store, never in adOmnia settings.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button type="button" onClick={close} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{busy && <Loader2 size={11} className="animate-spin" />} Save</button>
        </div>
      </div>
    </div>
  )
}
