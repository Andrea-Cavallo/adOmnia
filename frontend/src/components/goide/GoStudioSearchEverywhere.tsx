import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { showModule } from '@/lib/moduleRouting'
import { ArrowRight, FlaskConical, History, Loader2, Play, Search, Settings, Terminal } from 'lucide-react'
import { quickOpenGoIDEFiles, type GoIDEQuickOpenResult } from '@/lib/goide-api'
import { requestWorkspaceSymbols, type GoIDEWorkspaceSymbol } from '@/lib/goide-lsp-api'
import { COMMAND_PALETTE_PANEL_FEATURES, isFeatureVisible, type FeatureDef } from '@/lib/featureRegistry'
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
import { pinnedFirst } from '@/lib/goide/goStudioRunHistory'
import { SETTINGS_INDEX, bindingSearchText, readRecentCommands, rememberCommand, testTargetFromSymbol, type GoStudioSettingEntry } from './goStudioSearchExtras'
import { GoStudioPalette } from './GoStudioModal'

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
  showModule('settings')
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
  const inputRef = useRef<HTMLInputElement>(null)
  const lspReady = useGoIDELspStore((state) => state.status[sessionId]?.state === 'ready')
  const featureFlags = useSettingsStore((state) => state.settings.features)
  const openDocument = useGoIDEStore((state) => state.openDocument)
  const session = useGoIDEStore((state) => state.sessions.find((item) => item.id === sessionId))
  const runConfigs = useGoIDEStore((state) => state.runConfigsBySession[sessionId])
  const [recent, setRecent] = useState<string[]>([])

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
      ...panels.map((feature) => panelRow(feature, (target) => close(() => showModule(target.id))())),
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
    <GoStudioPalette
      open
      wide
      onClose={onClose}
      ariaLabel="Search Everywhere"
      icon={Search}
      input={
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
          onKeyDown={onKeyDown}
          placeholder={lspReady ? 'Search files, symbols, tests, actions and settings' : 'Search files, actions and settings · symbols and tests need gopls'}
          aria-label="Search Everywhere"
          className="gs-palette-input"
        />
      }
      meta={loading ? <Loader2 size={14} className="animate-spin" /> : <span className="gs-kbd">Shift Shift</span>}
    >
      <div role="listbox" aria-label="Results">
        {rows.map((row, index) => (
          <div key={row.key}>
            {(index === 0 || rows[index - 1].section !== row.section) && <div className="gs-palette-group gs-section-title">{row.section}</div>}
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              aria-disabled={!!row.disabled}
              title={row.disabled}
              onMouseEnter={() => setSelected(index)}
              onClick={() => activate(row)}
              className={`gs-palette-item ${row.disabled ? 'opacity-45' : ''}`}
            >
              <span className="grid w-4 shrink-0 place-items-center">{row.icon}</span>
              <span className="gs-palette-item-title">{row.title}</span>
              <span className="gs-palette-item-detail">{row.disabled ?? row.detail}</span>
              {row.hint && <kbd className="gs-kbd">{row.hint}</kbd>}
            </button>
          </div>
        ))}
        {!loading && rows.length === 0 && <p className="gs-palette-empty">Nothing matches “{query}”.</p>}
      </div>
    </GoStudioPalette>
  )
}
