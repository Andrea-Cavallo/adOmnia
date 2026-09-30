import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, TerminalSquare, X } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { GoStudioTerminalView, closeTerminal } from './GoStudioTerminalView'
import { startGoStudioTerminalBus } from './goStudioTerminalBus'
import { useGoIDELspStore } from '@/stores/goideLsp'
import {
  listGoIDETerminalProfiles,
  listGoIDETerminals,
  openGoIDETerminal,
  type GoIDETerminalProfile,
  type GoIDESession,
  type GoIDETerminalSession,
} from '@/lib/goide-api'

startGoStudioTerminalBus()

interface GoStudioTerminalPanelProps {
  session: GoIDESession
  /** Alla prima apertura della scheda si avvia subito una shell, senza passare dal +. */
  visible: boolean
}

const PROFILE_KEY = 'adomnia.goide.terminalProfile'

function readPreferredProfile(): string {
  try { return localStorage.getItem(PROFILE_KEY) ?? '' } catch { return '' }
}

function writePreferredProfile(id: string): void {
  try { localStorage.setItem(PROFILE_KEY, id) } catch { /* preferenza solo locale */ }
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Pannello dei terminali PTY della sessione. Ogni terminale ha nome, stato e
 * chiusura indipendenti; la Run console resta un pannello separato perché
 * mostra un'esecuzione controllata, non una shell interattiva.
 */
export function GoStudioTerminalPanel({ session, visible }: GoStudioTerminalPanelProps) {
  const [terminals, setTerminals] = useState<GoIDETerminalSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const autoOpened = useRef(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const authorized = session.project.authorization === 'tooling-permitted'
  const [profiles, setProfiles] = useState<GoIDETerminalProfile[]>([])
  const [preferredProfile, setPreferredProfile] = useState(readPreferredProfile)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null)
  // Il profilo scelto l'ultima volta, se esiste ancora; altrimenti quello predefinito del backend.
  const defaultProfile = profiles.some((profile) => profile.id === preferredProfile) ? preferredProfile : ''

  useEffect(() => {
    listGoIDETerminalProfiles().then(setProfiles).catch((reason) => setError(errorText(reason))).finally(() => setProfilesLoaded(true))
  }, [])

  useEffect(() => {
    let cancelled = false
    // Il pannello resta montato passando fra progetti: lo stato del progetto precedente non va riusato.
    setTerminals([])
    setActiveId(null)
    void listGoIDETerminals(session.id)
      .then((existing) => {
        if (cancelled) return
        setTerminals(existing)
        setActiveId((current) => (current && existing.some((item) => item.id === current) ? current : existing[0]?.id ?? null))
        setLoaded(true)
      })
      .catch((reason) => !cancelled && setError(errorText(reason)))
    return () => {
      cancelled = true
      setLoaded(false)
      autoOpened.current = false
    }
  }, [session.id])

  const open = useCallback(async (profile?: string, workingDirectory = '') => {
    setBusy(true)
    setError(null)
    try {
      const opened = await openGoIDETerminal({
        sessionId: session.id,
        profile: profile ?? defaultProfile,
        name: '',
        workingDirectory,
        columns: 80,
        rows: 24,
      })
      setTerminals((current) => [...current, opened])
      setActiveId(opened.id)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }, [defaultProfile, session.id])

  // Open In → Terminal dall'albero: la richiesta si consuma una volta sola e sostituisce l'apertura automatica alla radice.
  const terminalRequest = useGoIDELspStore((state) => state.terminalRequest)
  useEffect(() => {
    if (!terminalRequest || !loaded || !profilesLoaded) return
    useGoIDELspStore.setState({ terminalRequest: null })
    autoOpened.current = true
    void open(undefined, terminalRequest.workingDirectory)
  }, [loaded, open, profilesLoaded, terminalRequest])

  useEffect(() => {
    if (!visible || !loaded || !profilesLoaded || !authorized || busy || terminals.length > 0 || autoOpened.current) return
    autoOpened.current = true
    void open()
  }, [authorized, busy, loaded, open, profilesLoaded, terminals.length, visible])

  const close = useCallback(async (terminalId: string) => {
    try {
      await closeTerminal(terminalId)
    } catch (reason) {
      setError(errorText(reason))
    }
    setTerminals((current) => current.filter((item) => item.id !== terminalId))
    setActiveId((current) => {
      if (current !== terminalId) return current
      const remaining = terminals.filter((item) => item.id !== terminalId)
      return remaining[0]?.id ?? null
    })
  }, [terminals])

  const markExited = useCallback((terminalId: string) => {
    setTerminals((current) => current.map((item) => (item.id === terminalId ? { ...item, status: 'exited' } : item)))
  }, [])

  if (!authorized) {
    return (
      <section aria-label="Go Studio terminals" className="flex h-full min-h-0 flex-col items-start gap-2 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-3">
          <TerminalSquare size={11} /> Terminal
        </div>
        <p className="text-[11px] leading-4 text-text-4">
          Authorize tooling for this project to open a real shell. Opening a project never starts a process on its own.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Go Studio terminals" className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-1 px-1">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`group flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] ${
              terminal.id === activeId ? 'bg-surface-3 text-text-1' : 'text-text-3 hover:bg-surface-2'
            }`}
          >
            <button type="button" onClick={() => setActiveId(terminal.id)} className="max-w-32 truncate">
              {terminal.name}
              {terminal.status !== 'running' && <span className="ml-1 text-text-4">({terminal.status})</span>}
            </button>
            <button
              type="button"
              onClick={() => void close(terminal.id)}
              title="Close terminal"
              className="grid h-4 w-4 place-items-center rounded text-text-4 opacity-0 hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          title={`New terminal (${profiles.find((profile) => profile.id === defaultProfile)?.name ?? profiles[0]?.name ?? 'default shell'})`}
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          disabled={busy || profiles.length === 0}
          aria-haspopup="menu"
          aria-expanded={!!profileMenu}
          title="Choose a shell: PowerShell, Command Prompt, Git Bash, WSL…"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setProfileMenu(profileMenu ? null : { x: rect.right - 220, y: rect.bottom + 4 })
          }}
          className="grid h-6 w-5 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"
        >
          <ChevronDown size={12} />
        </button>
        {profileMenu && (
          <ContextMenu
            appearance="studio"
            x={profileMenu.x}
            y={profileMenu.y}
            items={profiles.map((profile, index) => ({
              id: profile.id,
              label: profile.name,
              icon: TerminalSquare,
              checked: profile.id === (defaultProfile || profiles[0]?.id),
              separatorBefore: index > 0 && profile.kind === 'wsl' && profiles[index - 1].kind !== 'wsl',
            }))}
            onSelect={(id) => {
              setProfileMenu(null)
              // La shell scelta diventa quella del +, come in JetBrains e VS Code.
              setPreferredProfile(id)
              writePreferredProfile(id)
              void open(id)
            }}
            onClose={() => setProfileMenu(null)}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[10px] text-danger">
          {error}
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 && (
          <p className="p-3 text-[10px] text-text-4">No terminal open. Use + to start a shell in the project directory.</p>
        )}
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className="absolute inset-0 p-1"
            style={{ visibility: terminal.id === activeId ? 'visible' : 'hidden' }}
          >
            <GoStudioTerminalView terminalId={terminal.id} active={terminal.id === activeId} onExit={markExited} />
          </div>
        ))}
      </div>
    </section>
  )
}
