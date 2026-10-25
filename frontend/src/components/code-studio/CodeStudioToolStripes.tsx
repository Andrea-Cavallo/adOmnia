import { useEffect, useState, type ComponentType } from 'react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { ResourceDetails, useResourceSample } from '@/components/layout/ResourceStatus'
import { Braces, Bug, ChevronDown, FlaskConical, Globe, GitBranch, ListChecks, Gauge, PackageSearch, TriangleAlert, Play, ScanSearch, Sparkles, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { diagnosticCounts, mergedReports, useCodeStudioLspStore, type GoIDEToolWindow } from '@/stores/codeStudioLsp'
import { selectedTestRun, useCodeStudioTestsStore } from '@/stores/codeStudioTests'
import { useCodeStudioDebugStore } from '@/stores/codeStudioDebug'
import { selectDebugState } from './codeStudioDebugCommands'
import { isChatPane, useCodeStudioAssistantStore, type CodeStudioAssistantPane } from '@/stores/codeStudioAssistant'
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
  onMouseEnter?: () => void
  /** Tooltip diverso dall'etichetta: per il bottone AI porta il messaggio classificato dello stato. */
  tooltip?: string
}

function StripeButton({ label, icon: Icon, pressed, badge, onClick, onMouseEnter, tooltip }: StripeButtonProps) {
  return (
    <button type="button" aria-label={label} title={tooltip ?? label} aria-pressed={pressed} onClick={onClick} onMouseEnter={onMouseEnter} className="code-studio-stripe-button">
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

/** The tool selector belongs to the open panel and follows its selected view. */
export function CodeStudioToolWindowMenu({ session, title }: { session: GoIDESession; title: string }) {
  const bottomOpen = useCodeStudioStore((state) => state.layout.bottomOpen)
  const toolWindow = useCodeStudioLspStore((state) => state.toolWindow)
  const badges = useToolWindowBadges(session.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => setMenu(null), [session.id, toolWindow, bottomOpen])
  if (!bottomOpen) return null
  const entry = TOOL_WINDOWS.find((item) => item.id === toolWindow)
  const Icon = entry?.icon
  return <>
    <button type="button" className="code-studio-tool-switcher" aria-label={`Tool window: ${title}`} title="Switch tool window" aria-haspopup="menu" aria-expanded={!!menu} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu(menu ? null : { x: rect.left, y: rect.bottom + 4 })
    }}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      <span>{title}</span>
      {badges[toolWindow] && <span className={`code-studio-tool-status ${BADGE_CLASS[badges[toolWindow]!]}`} aria-hidden="true" />}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={TOOL_WINDOWS.map(({ id, label, icon: ToolIcon }) => ({
      id, label, checked: id === toolWindow,
      iconElement: <span className="code-studio-tool-menu-icon"><ToolIcon size={15} />{badges[id] && <span className={`code-studio-tool-status ${BADGE_CLASS[badges[id]!]}`} />}</span>,
    }))} onClose={() => setMenu(null)} onSelect={(id) => {
      setMenu(null)
      if (id === 'preview') useLivePreviewStore.getState().show(session.id, 'panel')
      else useCodeStudioLspStore.getState().showToolWindow(id as GoIDEToolWindow)
    }} />}
  </>
}

/** Risorse dell'app sotto la stripe destra: campiona solo mentre il pannello è aperto. */
function ResourcesPanel() {
  const monitor = useResourceSample()
  return <ResourceDetails {...monitor} className="fixed bottom-9 right-10 z-50 w-[min(720px,95vw)]" />
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
