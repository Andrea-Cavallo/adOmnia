import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, FlaskConical, History, Loader2, Play, Search, Settings, Terminal, X } from 'lucide-react'
import { quickOpenGoIDEFiles, type GoIDEQuickOpenResult } from '@/lib/goide-api'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { COMMAND_PALETTE_PANEL_FEATURES, isFeatureVisible, type FeatureDef } from '@/lib/featureRegistry'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useAppStore } from '@/stores/app'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { useGoIDETestsStore } from '@/stores/goideTests'
import { useSettingsStore } from '@/stores/settings'
import { GO_STUDIO_COMMANDS, commandShortcut, type GoStudioCommand, type GoStudioCommandId } from './goStudioCommands'
import { GoStudioFileIcon } from './GoStudioFileIcon'
import { GoStudioSymbolIcon } from './GoStudioSymbolIcon'
import { navigateToLocation } from './goStudioLanguageFeatures'
import { matchScore, rankCandidates } from './goStudioSearchRanking'
import { testRequestForTarget } from './goStudioQuickActions'
import { pinnedFirst } from './goStudioRunHistory'
import { SETTINGS_INDEX, bindingSearchText, readRecentCommands, rememberCommand, testTargetFromSymbol, type GoStudioSettingEntry } from './goStudioSearchExtras'

const SEARCH_DEBOUNCE_MS = 120
const FILE_LIMIT = 8
const SYMBOL_LIMIT = 8
const ACTION_LIMIT = 8
const PANEL_LIMIT = 5
const RUN_CONFIG_LIMIT = 6
const SETTING_LIMIT = 5

interface GoStudioSearchEverywhereProps {
  open: boolean
  sessionId: string
  availability: (id: GoStudioCommandId) => true | string
  onCommand: (id: GoStudioCommandId) => void
  onClose: () => void
}

interface ResultRow {
  key: string
  section: 'Recent actions' | 'Files' | 'Tests' | 'Symbols' | 'Run configurations' | 'Actions' | 'Settings' | 'adOmnia panels'
  icon: ReactNode
  title: string
  detail: string
  hint?: string
  disabled?: string
  run: () => void
}

function fileRow(file: GoIDEQuickOpenResult, open: (path: string) => void): ResultRow {
  return {
    key: `file:${file.relativePath}`, section: 'Files', title: file.name, detail: file.relativePath,
    icon: <GoStudioFileIcon name={file.name} relativePath={file.relativePath} size={12} />,
    run: () => open(file.relativePath),
  }
}

function symbolRow(symbol: GoIDEWorkspaceSymbol): ResultRow {
  return {
    key: `symbol:${symbol.location.uri}:${symbol.location.range.startLine}:${symbol.name}`, section: 'Symbols', title: symbol.name,
    detail: `${symbol.container ? `${symbol.container} · ` : ''}${symbol.location.relativePath || symbol.location.path}`,
    icon: <GoStudioSymbolIcon kind={symbol.kind} size={12} />, run: () => navigateToLocation(symbol.location),
  }
}

function actionRow(command: GoStudioCommand, availability: true | string, run: (id: GoStudioCommandId) => void): ResultRow {
  return {
    key: `action:${command.id}`, section: 'Actions', title: command.label, detail: command.menu[0].toUpperCase() + command.menu.slice(1),
    hint: commandShortcut(command), disabled: availability === true ? undefined : availability,
    icon: <Terminal size={12} className="text-text-3" aria-hidden="true" />, run: () => run(command.id),
  }
}

function openSettingsSection(entry: GoStudioSettingEntry): void {
  // Come la mascotte dell'Hub: la sezione richiesta sopravvive al montaggio lazy del pannello Settings.
  try { sessionStorage.setItem('adomnia.settings.requested-section', entry.section) } catch { /* solo navigazione */ }
  useAppStore.getState().setActiveRail('settings')
  window.requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('adomnia:open-settings-section', { detail: entry.section })))
}

function panelRow(feature: FeatureDef, open: (feature: FeatureDef) => void): ResultRow {
  return {
    key: `panel:${feature.id}`, section: 'adOmnia panels', title: feature.railLabel ?? feature.title, detail: feature.group,
    icon: <ArrowRight size={12} className="text-text-3" aria-hidden="true" />, run: () => open(feature),
  }
}

/** Search Everywhere (Shift Shift): file, simboli del progetto, azioni dell'IDE e pannelli di adOmnia in un'unica ricerca. */
export function GoStudioSearchEverywhere({ open, sessionId, availability, onCommand, onClose }: GoStudioSearchEverywhereProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<GoIDEQuickOpenResult[]>([])
  const [symbols, setSymbols] = useState<GoIDEWorkspaceSymbol[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lspReady = useGoIDELspStore((state) => state.status[sessionId]?.state === 'ready')
  const featureFlags = useSettingsStore((state) => state.settings.features)
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const session = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId))
  const runConfigs = useGoIDEStore((state) => state.runConfigsBySession[sessionId])
  const [recent, setRecent] = useState<string[]>([])
  useModalFocusTrap(open, onClose, dialogRef)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    setRecent(readRecentCommands())
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const symbolRequest = lspReady && query.trim() ? requestWorkspaceSymbols(sessionId, query.trim()) : null
    const timer = window.setTimeout(() => {
      setLoading(true)
      const fileRequest = quickOpenGoIDEFiles(sessionId, query, FILE_LIMIT).catch(() => [])
      void Promise.all([fileRequest, symbolRequest?.catch(() => []) ?? Promise.resolve([])]).then(([nextFiles, nextSymbols]) => {
        if (cancelled) return
        setFiles(nextFiles)
        setSymbols(nextSymbols.slice(0, SYMBOL_LIMIT))
        setLoading(false)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      symbolRequest?.cancel()
    }
  }, [lspReady, open, query, sessionId])

  const rows = useMemo<ResultRow[]>(() => {
    const close = (action: () => void) => () => { onClose(); action() }
    const runCommand = (id: GoStudioCommandId) => close(() => { rememberCommand(id); onCommand(id) })
    const trimmed = query.trim()
    // La scorciatoia è cercabile: "ctrl shift f" trova Find in Files.
    const actions = rankCandidates(query, GO_STUDIO_COMMANDS.map((command) => ({ item: command, text: `${command.label} ${command.menu} ${bindingSearchText(commandShortcut(command))}` })), ACTION_LIMIT)
    const panels = rankCandidates(query, COMMAND_PALETTE_PANEL_FEATURES.filter((feature) => isFeatureVisible(feature.id, featureFlags)).map((feature) => ({ item: feature, text: `${feature.railLabel ?? feature.title} ${feature.keywords}` })), trimmed ? PANEL_LIMIT : 0)
    const settings = trimmed ? rankCandidates(query, SETTINGS_INDEX.map((entry) => ({ item: entry, text: `${entry.label} ${entry.keywords}` })), SETTING_LIMIT) : []
    const configs = rankCandidates(query, pinnedFirst(runConfigs ?? []).map((config) => ({ item: config, text: `${config.name} ${config.kind}` })), trimmed ? RUN_CONFIG_LIMIT : 0)
    const matchingSymbols = symbols.filter((symbol) => matchScore(query, `${symbol.container}.${symbol.name}`) !== null)
    const tests = session ? matchingSymbols.flatMap((symbol) => {
      const target = testTargetFromSymbol(symbol)
      return target ? [{ symbol, target }] : []
    }) : []
    const recentCommands = trimmed ? [] : recent.flatMap((id) => GO_STUDIO_COMMANDS.filter((command) => command.id === id))
    return [
      ...recentCommands.map((command) => ({ ...actionRow(command, availability(command.id), onCommand), key: `recent:${command.id}`, section: 'Recent actions' as const, icon: <History size={12} className="text-text-3" aria-hidden="true" />, run: runCommand(command.id) })),
      ...files.map((file) => fileRow(file, (path) => close(() => void openDocument(path))())),
      ...tests.map(({ symbol, target }) => ({
        key: `test:${symbol.location.relativePath}:${symbol.name}`, section: 'Tests' as const, title: symbol.name,
        detail: `Run ${target.kind === 'benchmark' ? 'benchmark' : 'test'} · ${target.packagePath}`,
        icon: <FlaskConical size={12} className="text-success" aria-hidden="true" />,
        disabled: session?.project.authorization === 'tooling-permitted' ? undefined : 'Trust the project to run tests',
        run: close(() => {
          useGoIDELspStore.getState().showToolWindow('tests')
          void useGoIDETestsStore.getState().start(testRequestForTarget(session!, target))
        }),
      })),
      // Mentre la nuova ricerca gopls è in corso restano visibili solo i simboli coerenti con il testo attuale.
      ...matchingSymbols.map((symbol) => ({ ...symbolRow(symbol), run: close(symbolRow(symbol).run) })),
      ...configs.map((config) => ({
        key: `config:${config.id}`, section: 'Run configurations' as const, title: config.name, detail: `Run · ${config.kind}`,
        icon: <Play size={12} className="text-success" aria-hidden="true" />,
        disabled: availability('run.run') === true ? undefined : String(availability('run.run')),
        run: close(() => { useGoIDEStore.getState().selectRunConfiguration(config.id); onCommand('run.run') }),
      })),
      ...actions.map((command) => ({ ...actionRow(command, availability(command.id), onCommand), run: runCommand(command.id) })),
      ...settings.map((entry) => ({
        key: `setting:${entry.label}`, section: 'Settings' as const, title: entry.label, detail: `Settings · ${entry.section}`,
        icon: <Settings size={12} className="text-text-3" aria-hidden="true" />, run: close(() => openSettingsSection(entry)),
      })),
      ...panels.map((feature) => panelRow(feature, (target) => close(() => useAppStore.getState().setActiveRail(target.id))())),
    ]
  }, [availability, featureFlags, files, onClose, onCommand, openDocument, query, recent, runConfigs, session, symbols])

  useEffect(() => { setSelected((value) => Math.min(value, Math.max(0, rows.length - 1))) }, [rows.length])

  if (!open) return null

  const activate = (row: ResultRow | undefined) => { if (row && !row.disabled) row.run() }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(rows.length - 1, value + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); activate(rows[selected]) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-[1px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search Everywhere" className="w-[min(720px,82vw)] overflow-hidden rounded-lg border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center gap-2 border-b border-border-1 px-3">
          <Search size={14} className="text-accent" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
            onKeyDown={onKeyDown}
            placeholder={lspReady ? 'Search files, tests, symbols, run configurations, actions, shortcuts and settings' : 'Search files, run configurations, actions, shortcuts and settings (symbols and tests need gopls)'}
            aria-label="Search Everywhere"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-4"
          />
          {loading && <Loader2 size={13} className="animate-spin text-text-4" aria-hidden="true" />}
          <span className="text-[9px] text-text-4">Shift Shift</span>
          <button type="button" onClick={onClose} title="Close · Esc" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} aria-hidden="true" /></button>
        </div>
        <div role="listbox" aria-label="Results" className="max-h-[58vh] overflow-auto py-1">
          {rows.map((row, index) => (
            <div key={row.key}>
              {(index === 0 || rows[index - 1].section !== row.section) && <div className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-wide text-text-4">{row.section}</div>}
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                aria-disabled={!!row.disabled}
                title={row.disabled}
                onMouseEnter={() => setSelected(index)}
                onClick={() => activate(row)}
                className={`flex h-7 w-full items-center gap-2 px-3 text-left ${index === selected ? 'bg-accent/15' : 'hover:bg-surface-3'} ${row.disabled ? 'opacity-45' : ''}`}
              >
                <span className="grid w-4 shrink-0 place-items-center">{row.icon}</span>
                <span className="shrink-0 text-[11px] font-medium text-text-1">{row.title}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{row.disabled ?? row.detail}</span>
                {row.hint && <kbd className="shrink-0 rounded border border-border-1 px-1 font-mono text-[9px] text-text-3">{row.hint}</kbd>}
              </button>
            </div>
          ))}
          {!loading && rows.length === 0 && <p className="px-4 py-8 text-center text-[11px] text-text-4">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>
  )
}
