import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { BRAND_ICONS } from '@/lib/brandIcons.generated'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { State } from '../../../bindings/adomnia/internal/copilot/models'
import type { CopilotSettings, CopilotStatus } from '@/lib/copilot-api'
import { useCopilotStore } from '@/stores/copilot'

interface Presentation {
  label: string
  tone: string
  spinning: boolean
}

/** Etichetta e colore per ogni stato: si capisce a colpo d'occhio se Copilot sta lavorando. */
export function copilotPresentation(status: CopilotStatus | null, percent: number | null): Presentation {
  switch (status?.state) {
    case State.StateReady: return { label: 'Copilot', tone: 'text-success', spinning: !!status.busy }
    case State.StateStarting: return { label: 'Copilot starting…', tone: 'text-text-3', spinning: true }
    case State.StateInstalling: return { label: percent === null ? 'Installing Copilot…' : `Installing Copilot ${percent}%`, tone: 'text-accent', spinning: true }
    case State.StateSignedOut: return { label: 'Copilot: sign in', tone: 'text-warning', spinning: false }
    case State.StateNotInstalled: return { label: 'Copilot: install', tone: 'text-warning', spinning: false }
    case State.StateUnauthorized: return { label: 'Copilot: no access', tone: 'text-warning', spinning: false }
    case State.StateWarning: return { label: 'Copilot', tone: 'text-warning', spinning: false }
    case State.StateError: return { label: 'Copilot error', tone: 'text-danger', spinning: false }
    default: return { label: 'Copilot off', tone: 'text-text-4', spinning: false }
  }
}

/** Account e host sempre espliciti: "andrea · company.ghe.com", mai solo "signed in". */
export function copilotAccountLabel(status: CopilotStatus | null): string {
  const profile = status?.profile
  if (!profile) return 'No GitHub profile'
  return status?.user ? `${status.user} · ${profile.host}` : `${profile.name} — ${profile.host}`
}

/** Voci del menu rapido in base allo stato; funzione pura, testabile. */
export function copilotMenuItems(status: CopilotStatus | null, settings: CopilotSettings | null): ContextMenuItem[] {
  const enabled = !!settings?.enabled
  const signedIn = status?.state === State.StateReady || status?.state === State.StateUnauthorized
  return [
    { id: 'account', label: copilotAccountLabel(status), disabled: true, disabledReason: 'Account and GitHub host used by Copilot' },
    ...(!enabled ? [{ id: 'enable', label: 'Enable GitHub Copilot', separatorBefore: true }] : []),
    ...(status?.state === State.StateNotInstalled ? [{ id: 'install', label: 'Install Copilot language server' }] : []),
    ...(enabled && status?.state === State.StateSignedOut ? [{ id: 'signIn', label: `Sign in to ${status.profile?.host ?? 'GitHub'}…` }] : []),
    ...(enabled ? [{ id: 'completions', label: 'Inline completions', checked: !!settings?.inlineCompletion, separatorBefore: true }] : []),
    ...(signedIn ? [{ id: 'signOut', label: 'Sign out' }] : []),
    ...(enabled ? [{ id: 'restart', label: 'Restart language server' }] : []),
    { id: 'settings', label: 'Copilot settings…', separatorBefore: true },
  ]
}

/** Logo GitHub nel colore dello stato (currentColor), non in quello del marchio. */
function GitHubMark({ size }: { size: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className="shrink-0"><path d={BRAND_ICONS.github.path} /></svg>
}

/** Voce della status bar di Go Studio: stato, account e host, menu rapido al clic. */
export function GoStudioCopilotStatus({ className }: { className: string }) {
  const status = useCopilotStore((state) => state.status)
  const settings = useCopilotStore((state) => state.settings)
  const install = useCopilotStore((state) => state.install)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const percent = install && install.total > 0 ? Math.round((install.downloaded * 100) / install.total) : null
  const view = copilotPresentation(status, percent)
  const title = [`GitHub Copilot: ${status?.message || view.label}`, copilotAccountLabel(status), status?.serverVersion ? `Language server ${status.serverVersion}` : '']
    .filter(Boolean).join('\n')

  const select = (id: string) => {
    setMenu(null)
    const store = useCopilotStore.getState()
    switch (id) {
      case 'enable': void store.setEnabled(true); break
      case 'install': void store.installServer(); break
      case 'signIn': store.setDialogOpen(true); void store.startSignIn(); break
      case 'completions': void store.toggleCompletions(); break
      case 'signOut': void store.signOut(); break
      case 'restart': void store.restart(); break
      case 'settings': store.setDialogOpen(true); break
    }
  }

  return (
    <>
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.left, y: rect.top - 4 })
        }}
        className={`${className} ${view.tone}`}
      >
        {view.spinning ? <Loader2 size={12} className="animate-spin" /> : <GitHubMark size={12} />}
        <span>{view.label}</span>
      </button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={copilotMenuItems(status, settings)} onSelect={select} onClose={() => setMenu(null)} />}
    </>
  )
}
