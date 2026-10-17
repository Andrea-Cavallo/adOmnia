import type { ComponentType } from 'react'
import { Bookmark, Braces, Bug, FlaskConical, FolderTree, GitCommitHorizontal, GitBranch, ListChecks, PackageSearch, TriangleAlert, Play, ScanSearch, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { diagnosticCounts, mergedReports, useGoIDELspStore, type GoIDEToolWindow } from '@/stores/goideLsp'
import { selectedTestRun, useGoIDETestsStore } from '@/stores/goideTests'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { selectDebugState } from './goStudioDebugCommands'
import { isChatPane, useGoStudioAssistantStore, type GoStudioAssistantPane } from '@/stores/goStudioAssistant'
import { useStudioTools } from './studioToolState'
import { aiProviderBadge, aiProviderTooltip, providerLabel } from './goStudioAiHub'
import { useAiProviders } from './useAiProviders'
import type { GoIDESession } from '@/lib/goide-api'

type BadgeTone = 'danger' | 'warning' | 'success' | 'accent'

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  accent: 'bg-accent',
}

interface StripeButtonProps {
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  pressed: boolean
  badge?: BadgeTone | null
  onClick: () => void
  /** Tooltip diverso dall'etichetta: per il bottone AI porta il messaggio classificato dello stato. */
  tooltip?: string
}

function StripeButton({ label, icon: Icon, pressed, badge, onClick, tooltip }: StripeButtonProps) {
  return (
    <button type="button" aria-label={label} title={tooltip ?? label} aria-pressed={pressed} onClick={onClick} className="go-studio-stripe-button">
      <Icon size={19} strokeWidth={1.8} />
      <span className="go-studio-stripe-tooltip" aria-hidden="true">{tooltip ?? label}</span>
      {badge && <span className={`go-studio-stripe-badge ${BADGE_CLASS[badge]}`} aria-hidden="true" />}
    </button>
  )
}

interface ToolWindowEntry {
  id: GoIDEToolWindow
  label: string
  icon: LucideIcon
}

const TOOL_WINDOWS: ReadonlyArray<ToolWindowEntry> = [
  { id: 'run', label: 'Run', icon: Play },
  { id: 'debug', label: 'Debug · Alt+5', icon: Bug },
  { id: 'tests', label: 'Tests · Alt+8', icon: FlaskConical },
  { id: 'terminal', label: 'Terminal · Alt+F12', icon: SquareTerminal },
  { id: 'problems', label: 'Problems · Alt+6', icon: TriangleAlert },
  { id: 'references', label: 'Usages', icon: ScanSearch },
  { id: 'git', label: 'Git · Branches and history', icon: GitBranch },
  { id: 'todo', label: 'TODO', icon: ListChecks },
]

/** Pallino di stato per ogni tool window: errori, test falliti, debug in pausa o attivo. */
function useToolWindowBadges(sessionId: string): Partial<Record<GoIDEToolWindow, BadgeTone>> {
  const reports = useGoIDELspStore((state) => state.diagnostics[sessionId])
  const lintReports = useGoIDELspStore((state) => state.lint[sessionId]?.reports)
  const failedTests = useGoIDETestsStore((state) => selectedTestRun(state, sessionId)?.summary.failed ?? 0)
  const debugState = useGoIDEDebugStore(selectDebugState(sessionId))
  const running = useGoIDEStore((state) => state.executions.some((execution) => execution.sessionId === sessionId && execution.status === 'running'))
  const counts = diagnosticCounts(mergedReports(reports, lintReports))
  return {
    problems: counts.errors ? 'danger' : counts.warnings ? 'warning' : undefined,
    tests: failedTests > 0 ? 'danger' : undefined,
    debug: debugState === 'stopped' ? 'warning' : debugState !== 'none' ? 'success' : undefined,
    run: running ? 'success' : undefined,
  }
}

interface GoStudioLeftStripeProps {
  session: GoIDESession
  onCommit: () => void
  onBookmarks: () => void
}

/** Barra sinistra: Project, Commit e Bookmarks in alto, le tool window del pannello inferiore in basso. */
export function GoStudioLeftStripe({ session, onCommit, onBookmarks }: GoStudioLeftStripeProps) {
  const sessionId = session.id
  const projectOpen = useGoIDEStore((state) => state.layout.projectOpen)
  const bottomOpen = useGoIDEStore((state) => state.layout.bottomOpen)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const toolWindow = useGoIDELspStore((state) => state.toolWindow)
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  const badges = useToolWindowBadges(sessionId)

  // Project e tool window inferiori sono indipendenti: aprire Run non deve chiudere il progetto.
  const restoreLayout = () => useStudioTools.setState({ maximized: null })
  const toggleToolWindow = (id: GoIDEToolWindow) => {
    const close = bottomOpen && toolWindow === id
    restoreLayout()
    if (close) updateLayout({ bottomOpen: false })
    else showToolWindow(id)
  }

  return (
    <nav aria-label="Go Studio tool windows" className="go-studio-stripe">
      <StripeButton label="Project" icon={FolderTree} pressed={projectOpen} onClick={() => { restoreLayout(); updateLayout({ projectOpen: !projectOpen }) }} />
      <StripeButton label="Commit · Ctrl+K" icon={GitCommitHorizontal} pressed={false} onClick={() => { restoreLayout(); onCommit() }} />
      <StripeButton label="Bookmarks · Shift+F11" icon={Bookmark} pressed={false} onClick={() => { restoreLayout(); onBookmarks() }} />
      <div className="flex-1" />
      {TOOL_WINDOWS.map((entry) => (
        <StripeButton key={entry.id} label={entry.label} icon={entry.icon} pressed={bottomOpen && toolWindow === entry.id} badge={badges[entry.id]} onClick={() => toggleToolWindow(entry.id)} />
      ))}
    </nav>
  )
}

interface GoStudioRightStripeProps {
  onDependencies: () => void
}

/** Barra destra: Structure, l'hub AI con il provider attivo e le dipendenze del modulo. */
export function GoStudioRightStripe({ onDependencies }: GoStudioRightStripeProps) {
  const structureOpen = useGoIDEStore((state) => state.layout.structureOpen)
  const structureWidth = useGoIDEStore((state) => state.layout.structureWidth)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const assistantPane = useGoStudioAssistantStore((state) => state.pane)
  // Un solo bottone: riapre l'ultimo provider scelto nell'hub, con il suo stato.
  const lastProvider = useGoStudioAssistantStore((state) => state.lastProvider)
  const providers = useAiProviders()
  const toggleAssistant = (pane: Exclude<GoStudioAssistantPane, null>) => {
    if (structureOpen && assistantPane === pane) {
      useGoStudioAssistantStore.getState().close()
      return updateLayout({ structureOpen: false })
    }
    useGoStudioAssistantStore.getState().open(pane)
    updateLayout({ structureOpen: true, structureWidth: Math.max(340, structureWidth) })
  }
  return (
    <nav aria-label="Go Studio side tool windows" className="go-studio-stripe">
      <StripeButton label="Structure · Alt+7" icon={Braces} pressed={structureOpen && !assistantPane} onClick={() => { useGoStudioAssistantStore.getState().close(); updateLayout({ structureOpen: !!assistantPane || !structureOpen }) }} />
      <StripeButton
        label={`AI Assistant · ${providerLabel(lastProvider)} · Alt+2`}
        icon={Sparkles}
        pressed={structureOpen && isChatPane(assistantPane)}
        badge={aiProviderBadge(providers[lastProvider].tone)}
        tooltip={aiProviderTooltip(providers[lastProvider].tone, providers[lastProvider].message, providerLabel(lastProvider))}
        onClick={() => toggleAssistant(lastProvider)}
      />
      <StripeButton label="Module Dependencies" icon={PackageSearch} pressed={false} onClick={onDependencies} />
    </nav>
  )
}
