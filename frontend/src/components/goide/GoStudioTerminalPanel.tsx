import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp, Columns2, Copy, FlaskConical, History, Plus, Search, TerminalSquare, Trash2, X } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { GoStudioTerminalView, closeTerminal, terminalHandle } from './GoStudioTerminalView'
import { startGoStudioTerminalBus } from './goStudioTerminalBus'
import { detectGoCommand, projectRelativePath, pushHistory, terminalLinkTarget, type GoStudioDetectedGoCommand, type GoStudioTerminalLink } from './goStudioTerminalLinks'
import { readSavedTerminals, snapshotTerminals, writeSavedTerminals } from './goStudioTerminalRestore'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDETestsStore } from '@/stores/goideTests'
import {
  listGoIDETerminalProfiles,
  listGoIDETerminals,
  openGoIDETerminal,
  renameGoIDETerminal,
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
const HISTORY_KEY = 'adomnia.goide.terminalHistory:'

function readPreferredProfile(): string {
  try { return localStorage.getItem(PROFILE_KEY) ?? '' } catch { return '' }
}

function writePreferredProfile(id: string): void {
  try { localStorage.setItem(PROFILE_KEY, id) } catch { /* preferenza solo locale */ }
}

function readHistory(projectPath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY + projectPath) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeHistory(projectPath: string, history: string[]): void {
  try { localStorage.setItem(HISTORY_KEY + projectPath, JSON.stringify(history)) } catch { /* cronologia solo locale */ }
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

interface DetectedTest {
  terminalId: string
  command: string
  test: NonNullable<GoStudioDetectedGoCommand['test']>
}

const toolButton = 'grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35'

/**
 * Pannello dei terminali PTY della sessione. Ogni terminale ha nome, stato e
 * chiusura indipendenti; la Run console resta un pannello separato perché
 * mostra un'esecuzione controllata, non una shell interattiva.
 */
export function GoStudioTerminalPanel({ session, visible }: GoStudioTerminalPanelProps) {
  const [terminals, setTerminals] = useState<GoIDETerminalSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const autoOpened = useRef(false)
  const openedProfiles = useRef(new Map<string, string>())
  const [activeId, setActiveId] = useState<string | null>(null)
  // Il secondo terminale mostrato accanto al primo; null quando il pannello non è diviso.
  const [splitId, setSplitId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const authorized = session.project.authorization === 'tooling-permitted'
  const [profiles, setProfiles] = useState<GoIDETerminalProfile[]>([])
  const [preferredProfile, setPreferredProfile] = useState(readPreferredProfile)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [profileMenu, setProfileMenu] = useState<{ x: number; y: number } | null>(null)
  const [historyMenu, setHistoryMenu] = useState<{ x: number; y: number } | null>(null)
  const [history, setHistory] = useState<string[]>(() => readHistory(session.project.realPath))
  const [detected, setDetected] = useState<DetectedTest | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement | null>(null)
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const openExternalLocation = useGoIDEStore((state) => state.openExternalLocation)
  const projectRoots = [session.project.rootPath, session.project.realPath]
  // Il profilo scelto l'ultima volta, se esiste ancora; altrimenti quello predefinito del backend.
  const defaultProfile = profiles.some((profile) => profile.id === preferredProfile) ? preferredProfile : ''
  const splitVisible = !!splitId && splitId !== activeId && terminals.some((item) => item.id === splitId)
  const targetId = focusedId && (focusedId === activeId || (splitVisible && focusedId === splitId)) ? focusedId : activeId

  useEffect(() => {
    listGoIDETerminalProfiles().then(setProfiles).catch((reason) => setError(errorText(reason))).finally(() => setProfilesLoaded(true))
  }, [])

  useEffect(() => {
    let cancelled = false
    // Il pannello resta montato passando fra progetti: lo stato del progetto precedente non va riusato.
    setTerminals([])
    setActiveId(null)
    setSplitId(null)
    setDetected(null)
    setHistory(readHistory(session.project.realPath))
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
  }, [session.id, session.project.realPath])

  const open = useCallback(async (profile?: string, workingDirectory = '', asSplit = false, name = '') => {
    setBusy(true)
    setError(null)
    try {
      const chosenProfile = profile ?? defaultProfile
      const opened = await openGoIDETerminal({
        sessionId: session.id,
        profile: chosenProfile,
        name,
        workingDirectory,
        columns: 80,
        rows: 24,
      })
      openedProfiles.current.set(opened.id, chosenProfile)
      setTerminals((current) => [...current, opened])
      if (asSplit) setSplitId(opened.id)
      else setActiveId(opened.id)
      setFocusedId(opened.id)
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
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

  // Alla prima apertura si ripristinano i terminali dell'ultima volta (nome, shell, cartella); altrimenti una shell alla radice.
  useEffect(() => {
    if (!visible || !loaded || !profilesLoaded || !authorized || busy || terminals.length > 0 || autoOpened.current) return
    autoOpened.current = true
    const saved = readSavedTerminals(session.project.realPath)
    if (saved.length === 0) return void open()
    void (async () => {
      for (const item of saved) {
        const profile = profiles.some((candidate) => candidate.id === item.profile) ? item.profile : undefined
        // La cartella può non esistere più: si riapre alla radice del progetto.
        if (!(await open(profile, item.workingDirectory, false, item.name)) && item.workingDirectory) await open(profile, '', false, item.name)
      }
    })()
  }, [authorized, busy, loaded, open, profiles, profilesLoaded, session.project.realPath, terminals.length, visible])

  // Salva solo dopo il caricamento e il primo ripristino, così una lista vuota iniziale non cancella quella salvata.
  useEffect(() => {
    if (!loaded || (!autoOpened.current && terminals.length === 0)) return
    const projectPath = session.project.realPath
    const roots = [session.project.rootPath, projectPath]
    writeSavedTerminals(projectPath, snapshotTerminals(terminals, openedProfiles.current, readSavedTerminals(projectPath), roots))
  }, [loaded, session.project.realPath, session.project.rootPath, terminals])

  const close = useCallback(async (terminalId: string) => {
    try {
      await closeTerminal(terminalId)
    } catch (reason) {
      setError(errorText(reason))
    }
    const remaining = terminals.filter((item) => item.id !== terminalId)
    const splitSurvives = !!splitId && splitId !== terminalId && remaining.some((item) => item.id === splitId)
    setTerminals(remaining)
    setDetected((current) => (current?.terminalId === terminalId ? null : current))
    if (terminalId === splitId) {
      setSplitId(null)
    } else if (terminalId === activeId) {
      // Chiudendo il terminale di sinistra, quello diviso prende il suo posto.
      setActiveId(splitSurvives ? splitId : remaining[0]?.id ?? null)
      if (splitSurvives) setSplitId(null)
    }
  }, [activeId, splitId, terminals])

  const markExited = useCallback((terminalId: string) => {
    setTerminals((current) => current.map((item) => (item.id === terminalId ? { ...item, status: 'exited' } : item)))
  }, [])

  const selectTab = (terminalId: string) => {
    // Il tab del terminale diviso scambia i due lati invece di nasconderlo.
    if (terminalId === splitId && activeId) setSplitId(activeId)
    setActiveId(terminalId)
    setFocusedId(terminalId)
  }

  const rename = async (terminalId: string, name: string) => {
    setRenamingId(null)
    const current = terminals.find((item) => item.id === terminalId)
    if (!current || !name.trim() || name.trim() === current.name) return
    try {
      const renamed = await renameGoIDETerminal(terminalId, name)
      setTerminals((items) => items.map((item) => (item.id === terminalId ? { ...item, name: renamed.name } : item)))
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  const openLink = useCallback((terminalId: string, link: GoStudioTerminalLink) => {
    const workingDirectory = terminals.find((item) => item.id === terminalId)?.workingDirectory ?? session.project.realPath
    const target = terminalLinkTarget(link.path, workingDirectory, [session.project.rootPath, session.project.realPath])
    if (target.kind === 'project') void openLocation(target.relativePath, link.line, link.column)
    else void openExternalLocation(target.path, link.line, link.column)
  }, [openExternalLocation, openLocation, session.project.realPath, session.project.rootPath, terminals])

  const recordCommand = useCallback((terminalId: string, command: string) => {
    setHistory((current) => {
      const next = pushHistory(current, command)
      writeHistory(session.project.realPath, next)
      return next
    })
    const goCommand = detectGoCommand(command)
    setDetected(goCommand?.test ? { terminalId, command, test: goCommand.test } : null)
  }, [session.project.realPath])

  const runDetectedTest = () => {
    if (!detected) return
    const terminal = terminals.find((item) => item.id === detected.terminalId)
    // ponytail: la cartella è quella di apertura del terminale; un `cd` successivo nella shell non si vede.
    const workingDirectory = projectRelativePath(terminal?.workingDirectory ?? '', projectRoots)
    setDetected(null)
    if (workingDirectory === null) {
      setError('This terminal started outside the project: run the tests from the Tests tool window.')
      return
    }
    useGoIDELspStore.getState().showToolWindow('tests')
    void useGoIDETestsStore.getState().start({ sessionId: session.id, workingDirectory, ...detected.test })
  }

  const copyOutput = async () => {
    const handle = terminalHandle(targetId)
    if (!handle) return
    try {
      await navigator.clipboard.writeText(handle.cleanText())
      setNotice('Output copied without colors or control codes.')
      setTimeout(() => setNotice(null), 2000)
    } catch (reason) {
      setError(`Clipboard not available: ${errorText(reason)}`)
    }
  }

  const find = (backwards = false) => {
    const handle = terminalHandle(targetId)
    if (!handle || !query) return
    const found = backwards ? handle.search.findPrevious(query) : handle.search.findNext(query)
    if (!found) setNotice(`No match for “${query}”.`)
    else setNotice(null)
  }

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setTimeout(() => searchInput.current?.select(), 0)
  }, [])

  const toggleSplit = () => {
    if (splitVisible) {
      setSplitId(null)
      setFocusedId(activeId)
      return
    }
    // Un altro terminale già aperto va di fianco; altrimenti se ne apre uno nuovo.
    const other = terminals.find((item) => item.id !== activeId)
    if (other) setSplitId(other.id)
    else void open(undefined, '', true)
  }

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

  const paneStyle = (terminalId: string): CSSProperties => {
    if (terminalId === activeId) return { visibility: 'visible', left: 0, right: splitVisible ? '50%' : 0 }
    if (splitVisible && terminalId === splitId) return { visibility: 'visible', left: '50%', right: 0 }
    return { visibility: 'hidden', left: 0, right: 0 }
  }

  return (
    <section aria-label="Go Studio terminals" className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border-1 px-1">
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {terminals.map((terminal) => {
            const shown = terminal.id === activeId || (splitVisible && terminal.id === splitId)
            return (
              <div
                key={terminal.id}
                className={`group flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] ${
                  terminal.id === targetId ? 'bg-surface-3 text-text-1' : shown ? 'bg-surface-2 text-text-2' : 'text-text-3 hover:bg-surface-2'
                }`}
              >
                {renamingId === terminal.id ? (
                  <input
                    autoFocus
                    defaultValue={terminal.name}
                    maxLength={64}
                    aria-label="Terminal name"
                    onBlur={(event) => void rename(terminal.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void rename(terminal.id, event.currentTarget.value)
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                    className="h-5 w-28 rounded border border-accent/60 bg-surface-1 px-1 text-[10px] text-text-1 outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => selectTab(terminal.id)}
                    onDoubleClick={() => setRenamingId(terminal.id)}
                    title="Double-click to rename"
                    className="max-w-32 truncate"
                  >
                    {terminal.name}
                    {terminal.status !== 'running' && <span className="ml-1 text-text-4">({terminal.status})</span>}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void close(terminal.id)}
                  title="Close terminal"
                  className="grid h-4 w-4 place-items-center rounded text-text-4 opacity-0 hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
        {/* + e scelta della shell subito dopo le schede, come in VS Code e GoLand: visibili anche con il pannello stretto. */}
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          title={`New terminal (${profiles.find((profile) => profile.id === defaultProfile)?.name ?? profiles[0]?.name ?? 'default shell'})`}
          className={toolButton}
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          disabled={busy || profiles.length === 0}
          aria-haspopup="menu"
          aria-expanded={!!profileMenu}
          title="New terminal with another shell: PowerShell, Command Prompt, Git Bash, WSL…"
          aria-label="Choose shell"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setProfileMenu(profileMenu ? null : { x: rect.right - 220, y: rect.bottom + 4 })
          }}
          className="grid h-6 w-5 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-35"
        >
          <ChevronDown size={12} />
        </button>
        <div className="min-w-2 flex-1" />
        <button type="button" onClick={openSearch} disabled={!targetId} title="Find in terminal (Ctrl+F)" className={toolButton}>
          <Search size={12} />
        </button>
        <button type="button" onClick={() => void copyOutput()} disabled={!targetId} title="Copy output as plain text" className={toolButton}>
          <Copy size={12} />
        </button>
        <button type="button" onClick={() => terminalHandle(targetId)?.clear()} disabled={!targetId} title="Clear scrollback" className={toolButton}>
          <Trash2 size={12} />
        </button>
        <button
          type="button"
          disabled={!targetId}
          aria-haspopup="menu"
          aria-expanded={!!historyMenu}
          title="Command history of this project"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setHistoryMenu(historyMenu ? null : { x: rect.right - 320, y: rect.bottom + 4 })
          }}
          className={toolButton}
        >
          <History size={12} />
        </button>
        <button type="button" onClick={toggleSplit} disabled={busy || !activeId} aria-pressed={splitVisible} title={splitVisible ? 'Unsplit terminals' : 'Split terminal'} className={`${toolButton} ${splitVisible ? 'bg-surface-3 text-text-1' : ''}`}>
          <Columns2 size={12} />
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
        {historyMenu && (
          <ContextMenu
            appearance="studio"
            x={historyMenu.x}
            y={historyMenu.y}
            items={history.length === 0
              ? [{ id: 'empty', label: 'No commands yet', disabled: true }]
              : [
                  ...history.map((command, index) => ({ id: `cmd:${index}`, label: command, icon: detectGoCommand(command) ? FlaskConical : undefined })),
                  { id: 'clear', label: 'Clear history', separatorBefore: true, danger: true },
                ]}
            onSelect={(id) => {
              setHistoryMenu(null)
              if (id === 'clear') {
                setHistory([])
                writeHistory(session.project.realPath, [])
                return
              }
              const command = history[Number(id.slice(4))]
              // Il comando si inserisce senza Invio: niente viene eseguito finché l'utente non conferma.
              if (command) terminalHandle(targetId)?.paste(command)
            }}
            onClose={() => setHistoryMenu(null)}
          />
        )}
      </div>

      {searchOpen && (
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-2">
          <Search size={11} className="text-text-4" />
          <input
            ref={searchInput}
            value={query}
            aria-label="Find in terminal"
            placeholder="Find in terminal"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey) }
              if (event.key === 'Escape') { setSearchOpen(false); terminalHandle(targetId)?.search.clearDecorations(); terminalHandle(targetId)?.focus() }
            }}
            className="h-5 min-w-0 flex-1 bg-transparent text-[11px] text-text-1 outline-none placeholder:text-text-4"
          />
          <button type="button" onClick={() => find(true)} title="Previous match (Shift+Enter)" className={toolButton}><ChevronUp size={12} /></button>
          <button type="button" onClick={() => find()} title="Next match (Enter)" className={toolButton}><ChevronDown size={12} /></button>
          <button type="button" onClick={() => { setSearchOpen(false); terminalHandle(targetId)?.focus() }} title="Close (Esc)" className={toolButton}><X size={12} /></button>
        </div>
      )}

      {detected && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 text-[10px] text-text-2">
          <FlaskConical size={11} className="text-accent" />
          <span className="min-w-0 flex-1 truncate">
            Detected <code className="font-mono text-text-1">{detected.command}</code>: run it in the Test Explorer for a test tree, reruns and coverage.
          </span>
          <button type="button" onClick={runDetectedTest} className="rounded px-2 py-0.5 font-medium text-accent hover:bg-accent/15">Run in Test Explorer</button>
          <button type="button" onClick={() => setDetected(null)} title="Dismiss" className={toolButton}><X size={11} /></button>
        </div>
      )}

      {error && (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[10px] text-danger">
          {error}
        </p>
      )}
      {notice && <p role="status" className="shrink-0 border-b border-border-1 px-3 py-1 text-[10px] text-text-3">{notice}</p>}

      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 && (
          <p className="p-3 text-[10px] text-text-4">No terminal open. Use + to start a shell in the project directory.</p>
        )}
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={`absolute inset-y-0 p-1 ${splitVisible && terminal.id === splitId ? 'border-l border-border-1' : ''}`}
            style={paneStyle(terminal.id)}
            onMouseDown={() => setFocusedId(terminal.id)}
          >
            <GoStudioTerminalView
              terminalId={terminal.id}
              active={terminal.id === activeId || (splitVisible && terminal.id === splitId)}
              onExit={markExited}
              onOpenLink={openLink}
              onCommand={recordCommand}
              onFind={openSearch}
              onFocus={setFocusedId}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
