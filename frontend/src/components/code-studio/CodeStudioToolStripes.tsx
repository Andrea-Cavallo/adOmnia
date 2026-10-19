import { useState, type ComponentType } from 'react'
import { ResourceDetails, useResourceSample } from '@/components/layout/ResourceStatus'
import { Bookmark, Braces, Bug, FlaskConical, Globe, FolderTree, GitCommitHorizontal, GitBranch, ListChecks, Gauge, PackageSearch, TriangleAlert, Play, ScanSearch, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { diagnosticCounts, mergedReports, useCodeStudioLspStore, type GoIDEToolWindow } from '@/stores/codeStudioLsp'
import { selectedTestRun, useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { selectDebugState } from './codeStudioDebugCommands'
import { isChatPane, useCodeStudioAssistantStore, type CodeStudioAssistantPane } from '@/stores/codeStudioAssistant'
import { useStudioTools } from './studioToolState'
import { aiProviderBadge, aiProviderTooltip, providerLabel } from './codeStudioAiHub'
import { useAiProviders } from './useAiProviders'
import type { GoIDESession } from '@/lib/code-studio-api'
import { isRunning } from '@/lib/code-studio/livePreview'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'

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
    <button type="button" aria-label={label} title={tooltip ?? label} aria-pressed={pressed} onClick={onClick} className="code-studio-stripe-button">
      <Icon size={19} strokeWidth={1.8} />
      <span className="code-studio-stripe-tooltip" aria-hidden="true">{tooltip ?? label}</span>
      {badge && <span className={`code-studio-stripe-badge ${BADGE_CLASS[badge]}`} aria-hidden="true" />}
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
  { id: 'preview', label: 'Live Preview', icon: Globe },
  { id: 'problems', label: 'Problems · Alt+6', icon: TriangleAlert },
  { id: 'references', label: 'Usages', icon: ScanSearch },
  { id: 'git', label: 'Git · Branches and history', icon: GitBranch },
  { id: 'todo', label: 'TODO', icon: ListChecks },
]

/** Pallino di stato per ogni tool window: errori, test falliti, debug in pausa o attivo. */
function useToolWindowBadges(sessionId: string): Partial<Record<GoIDEToolWindow, BadgeTone>> {
  const reports = useCodeStudioLspStore((state) => state.diagnostics[sessionId])
  const lintReports = useCodeStudioLspStore((state) => state.lint[sessionId]?.reports)
  const failedTests = useCodeStudioTestsStore((state) => selectedTestRun(state, sessionId)?.summary.failed ?? 0)
  const debugState = useCodeStudioDebugStore(selectDebugState(sessionId))
  const running = useCodeStudioStore((state) => state.executions.some((execution) => execution.sessionId === sessionId && execution.status === 'running'))
  const counts = diagnosticCounts(mergedReports(reports, lintReports))
  const previewBadge = useLivePreviewStore((state) => {
    const view = selectSessionPreview(state, sessionId)
    if (view.previews.some((item) => item.state === 'failed')) return 'danger' as const
    return view.previews.some((item) => isRunning(item)) ? 'success' as const : undefined
  })
  return {
    problems: counts.errors ? 'danger' : counts.warnings ? 'warning' : undefined,
    tests: failedTests > 0 ? 'danger' : undefined,
    debug: debugState === 'stopped' ? 'warning' : debugState !== 'none' ? 'success' : undefined,
    run: running ? 'success' : undefined,
    preview: previewBadge,
  }
}

interface CodeStudioLeftStripeProps {
  session: GoIDESession
  onCommit: () => void
  onBookmarks: () => void
}

/** Barra sinistra: Project, Commit e Bookmarks in alto, le tool window del pannello inferiore in basso. */
export function CodeStudioLeftStripe({ session, onCommit, onBookmarks }: CodeStudioLeftStripeProps) {
  const sessionId = session.id
  const projectOpen = useCodeStudioStore((state) => state.layout.projectOpen)
  const bottomOpen = useCodeStudioStore((state) => state.layout.bottomOpen)
  const updateLayout = useCodeStudioStore((state) => state.updateLayout)
  const toolWindow = useCodeStudioLspStore((state) => state.toolWindow)
  const showToolWindow = useCodeStudioLspStore((state) => state.showToolWindow)
  const badges = useToolWindowBadges(sessionId)

  // Project e tool window inferiori sono indipendenti: aprire Run non deve chiudere il progetto.
  const restoreLayout = () => useStudioTools.setState({ maximized: null })
  const toggleToolWindow = (id: GoIDEToolWindow) => {
    const close = bottomOpen && toolWindow === id
    restoreLayout()
    if (close) updateLayout({ bottomOpen: false })
    else if (id === 'preview') useLivePreviewStore.getState().show(sessionId, 'panel')
    else showToolWindow(id)
  }

  return (
    <nav aria-label="Code Studio tool windows" className="code-studio-stripe">
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

/** Risorse dell'app sotto la stripe destra: campiona solo mentre il pannello è aperto. */
function ResourcesPanel() {
  const { sample, failed, history } = useResourceSample()
  return <ResourceDetails sample={sample} failed={failed} history={history} className="fixed bottom-9 right-10 z-50 w-[min(520px,90vw)]" />
}

interface CodeStudioRightStripeProps {
  onDependencies: () => void
}

/** Barra destra: Structure, l'hub AI con il provider attivo e le dipendenze del modulo. */
export function CodeStudioRightStripe({ onDependencies }: CodeStudioRightStripeProps) {
  const structureOpen = useCodeStudioStore((state) => state.layout.structureOpen)
  const structureWidth = useCodeStudioStore((state) => state.layout.structureWidth)
  const updateLayout = useCodeStudioStore((state) => state.updateLayout)
  const assistantPane = useCodeStudioAssistantStore((state) => state.pane)
  // Un solo bottone: riapre l'ultimo provider scelto nell'hub, con il suo stato.
  const lastProvider = useCodeStudioAssistantStore((state) => state.lastProvider)
  const providers = useAiProviders()
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const toggleAssistant = (pane: Exclude<CodeStudioAssistantPane, null>) => {
    if (structureOpen && assistantPane === pane) {
      useCodeStudioAssistantStore.getState().close()
      return updateLayout({ structureOpen: false })
    }
    useCodeStudioAssistantStore.getState().open(pane)
    updateLayout({ structureOpen: true, structureWidth: Math.max(340, structureWidth) })
  }
  return (
    <nav aria-label="Code Studio side tool windows" className="code-studio-stripe">
      <StripeButton label="Structure · Alt+7" icon={Braces} pressed={structureOpen && !assistantPane} onClick={() => { useCodeStudioAssistantStore.getState().close(); updateLayout({ structureOpen: !!assistantPane || !structureOpen }) }} />
      <StripeButton
        label={`AI Assistant · ${providerLabel(lastProvider)} · Alt+2`}
        icon={Sparkles}
        pressed={structureOpen && isChatPane(assistantPane)}
        badge={aiProviderBadge(providers[lastProvider].tone)}
        tooltip={aiProviderTooltip(providers[lastProvider].tone, providers[lastProvider].message, providerLabel(lastProvider))}
        onClick={() => toggleAssistant(lastProvider)}
      />
      <StripeButton label="Module Dependencies" icon={PackageSearch} pressed={false} onClick={onDependencies} />
      <StripeButton label="Resources · RAM, CPU and processes" icon={Gauge} pressed={resourcesOpen} onClick={() => setResourcesOpen((open) => !open)} />
      {resourcesOpen && <ResourcesPanel />}
    </nav>
  )
}
