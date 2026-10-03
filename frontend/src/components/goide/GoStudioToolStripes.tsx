import { Bookmark, Bot, Braces, Bug, FlaskConical, Folder, GitCommitHorizontal, ListTodo, ListTree, PackageSearch, AlertCircle, Play, SearchCode, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { diagnosticCounts, mergedReports, useGoIDELspStore, type GoIDEToolWindow } from '@/stores/goideLsp'
import { selectedTestRun, useGoIDETestsStore } from '@/stores/goideTests'
import { useGoIDEDebugStore } from '@/stores/goideDebug'
import { selectDebugState } from './goStudioDebugCommands'
import { useGoStudioAssistantStore, type GoStudioAssistantPane } from '@/stores/goStudioAssistant'

type BadgeTone = 'danger' | 'warning' | 'success' | 'accent'

const BADGE_CLASS: Record<BadgeTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  accent: 'bg-accent',
}

interface StripeButtonProps {
  label: string
  icon: LucideIcon
  pressed: boolean
  badge?: BadgeTone | null
  onClick: () => void
}

function StripeButton({ label, icon: Icon, pressed, badge, onClick }: StripeButtonProps) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} className="go-studio-stripe-button">
      <Icon size={16} strokeWidth={1.6} />
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
  { id: 'problems', label: 'Problems · Alt+6', icon: AlertCircle },
  { id: 'references', label: 'Usages', icon: ListTree },
  { id: 'find', label: 'Find in Files', icon: SearchCode },
  { id: 'todo', label: 'TODO', icon: ListTodo },
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
  sessionId: string
  onCommit: () => void
  onBookmarks: () => void
}

/** Barra sinistra: Project, Commit e Bookmarks in alto, le tool window del pannello inferiore in basso. */
export function GoStudioLeftStripe({ sessionId, onCommit, onBookmarks }: GoStudioLeftStripeProps) {
  const projectOpen = useGoIDEStore((state) => state.layout.projectOpen)
  const bottomOpen = useGoIDEStore((state) => state.layout.bottomOpen)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const toolWindow = useGoIDELspStore((state) => state.toolWindow)
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  const badges = useToolWindowBadges(sessionId)

  const toggleToolWindow = (id: GoIDEToolWindow) => {
    if (bottomOpen && toolWindow === id) return updateLayout({ bottomOpen: false })
    showToolWindow(id)
  }

  return (
    <nav aria-label="Go Studio tool windows" className="go-studio-stripe">
      <StripeButton label="Project" icon={Folder} pressed={projectOpen} onClick={() => updateLayout({ projectOpen: !projectOpen })} />
      <StripeButton label="Commit · Ctrl+K" icon={GitCommitHorizontal} pressed={false} onClick={onCommit} />
      <StripeButton label="Bookmarks · Shift+F11" icon={Bookmark} pressed={false} onClick={onBookmarks} />
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

/** Barra destra: Structure e dipendenze del modulo. */
export function GoStudioRightStripe({ onDependencies }: GoStudioRightStripeProps) {
  const structureOpen = useGoIDEStore((state) => state.layout.structureOpen)
  const structureWidth = useGoIDEStore((state) => state.layout.structureWidth)
  const updateLayout = useGoIDEStore((state) => state.updateLayout)
  const assistantPane = useGoStudioAssistantStore((state) => state.pane)
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
      <StripeButton label="Copilot Chat" icon={Sparkles} pressed={structureOpen && assistantPane === 'copilot'} onClick={() => toggleAssistant('copilot')} />
      <StripeButton label="a0" icon={Bot} pressed={structureOpen && assistantPane === 'a0'} onClick={() => toggleAssistant('a0')} />
      <StripeButton label="Module Dependencies" icon={PackageSearch} pressed={false} onClick={onDependencies} />
    </nav>
  )
}
