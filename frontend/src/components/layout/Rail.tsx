import { useEffect, useRef, useState } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { TOOL_TAB_LABELS, type ToolTabId } from '@/lib/types'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { useAppIcon } from '@/lib/brandAssets'
import { RAIL_CATEGORIES, getFeatureLabel, isFeatureVisible } from '@/lib/featureRegistry'
import { useNavigationTranslation, useUiTranslation } from '@/lib/uiI18n'
import { nextRovingFocusIndex } from '@/lib/accessibility'
import {
  Send, LayoutList, Shield, Server, Radio, Bug, Container, Network,
  Wrench, FileText, FileCode, Database, Braces, ChevronRight, FolderOpen,
  Lock, Puzzle, Settings, GitBranch,
  Zap, BarChart2, Activity, HardDrive, History, Layers,
  BookOpen, PanelsTopLeft, SquareTerminal,
} from 'lucide-react'

interface SubItem {
  id: RailItem
  icon?: React.ElementType
  label?: string
}

interface SubGroup {
  title: string
  items: SubItem[]
}

interface CategoryDef {
  key: string
  label: string
  code: string
  directItem?: RailItem
  groups: SubGroup[]
}

function Soap95Icon({ size = 12 }: { size?: number }) {
  return <img src="/icon95.png" alt="" style={{ width: size, height: size }} className="object-contain" />
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  api: Send,
  protocols: Radio,
  infra: PanelsTopLeft,
  debug: Bug,
  data: Database,
  tools: Wrench,
  docs: FileText,
  workspace: GitBranch,
}

const FEATURE_ICONS: Partial<Record<RailItem, React.ElementType>> = {
  collections: LayoutList,
  scenarios: Layers,
  history: History,
  flows: GitBranch,
  apidocs: BookOpen,
  websocket: Zap,
  sse: Radio,
  broker: Server,
  grpc: Send,
  soap: Soap95Icon,
  mcp: Network,
  mock: Server,
  proxy: Shield,
  dockerlab: Container,
  browser: Bug,
  har: BarChart2,
  observe: Activity,
  database: Database,
  storage: HardDrive,
  vault: Lock,
  jsonviewer: Braces,
  loginspector: Activity,
  xmltools: FileCode,
  powertools: Wrench,
  secretscanner: Shield,
  markdown: FileText,
  mermaid: GitBranch,
  latex: FileCode,
  pdfeditor: FileText,
  gitsync: GitBranch,
  themes: Settings,
  templates: FileText,
  plugins: Puzzle,
}

const CATEGORIES: CategoryDef[] = RAIL_CATEGORIES

// ─── Flyout panel (click-based, all items visible inline) ─────────────────────

interface FlyoutProps {
  cat: CategoryDef
  activeRail: RailItem
  onSelect: (id: RailItem) => void
  onClose: () => void
  onFocusTrigger: () => void
}

/** Rail entries that can also be opened as a workspace tab. */
const TOOL_TAB_RAILS = new Set<string>(Object.keys(TOOL_TAB_LABELS))

function Flyout({ cat, activeRail, onSelect, onClose, onFocusTrigger }: FlyoutProps) {
  const nav = useNavigationTranslation()
  const tr = useUiTranslation()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const [menuFor, setMenuFor] = useState<ToolTabId | null>(null)

  const openInNewTab = (tool: ToolTabId) => {
    openToolTab(tool)
    // Tool tabs live in the request workspace, so go there to reveal it.
    setActiveRail('collections')
    setMenuFor(null)
    onClose()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[role="menuitem"]') : null
    if (!target) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      target.click()
      return
    }
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault()
      onClose()
      requestAnimationFrame(onFocusTrigger)
      return
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const currentIndex = items.indexOf(target)
    const nextIndex = nextRovingFocusIndex(currentIndex, items.length, event.key)
    if (nextIndex === null) return
    event.preventDefault()
    items[nextIndex]?.focus()
  }

  return (
    <div id={`rail-menu-${cat.key}`} role="menu" aria-label={nav(cat.label)} onKeyDown={handleKeyDown} className="absolute left-full top-0 ml-2 w-52 bg-surface-1 border border-border-1 rounded-xl shadow-2xl z-50 py-2 overflow-hidden">
      <div className="px-3 pt-1 pb-2 border-b border-border-1/60">
        <span className="text-[10px] font-bold text-accent tracking-wide uppercase">{nav(cat.label)}</span>
      </div>

      {cat.groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="h-px bg-border-1/50 my-1 mx-3" />}
          <div className="px-3 pt-2 pb-0.5">
            <span className="text-[9px] font-semibold text-text-4 tracking-wider uppercase flex items-center gap-1">
              <FolderOpen size={9} />
              {nav(group.title)}
            </span>
          </div>
          {group.items.map((item) => {
            const active = activeRail === item.id
            const ItemIcon = item.icon ?? FEATURE_ICONS[item.id] ?? Wrench
            const label = item.label ?? getFeatureLabel(item.id)
            return (
              <button
                key={item.id}
                role="menuitem"
                onClick={() => { onSelect(item.id); onClose() }}
                onContextMenu={(e) => {
                  if (!TOOL_TAB_RAILS.has(item.id)) return
                  e.preventDefault()
                  setMenuFor(item.id as ToolTabId)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left',
                  active
                    ? 'text-text-1 bg-accent/10'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
                )}
              >
                <ItemIcon size={12} />
                <span className="flex-1">{nav(label)}</span>
                {active && <ChevronRight size={10} className="text-accent" />}
              </button>
            )
          })}
          {menuFor && group.items.some((i) => i.id === menuFor) && (
            <div className="px-3 py-1">
              <button
                onClick={() => openInNewTab(menuFor)}
                className="w-full text-left px-2 py-1.5 text-[11px] rounded bg-surface-2 text-text-1 hover:bg-accent/15 transition-colors"
              >
                {tr('Open in New Tab')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Category button ──────────────────────────────────────────────────────────

interface CategoryButtonProps {
  cat: CategoryDef
  activeRail: RailItem
  anyRunning?: boolean
  isOpen: boolean
  onToggle: () => void
  onOpen: () => void
  onSelect: (id: RailItem) => void
  onClose: () => void
}

function CategoryButton({ cat, activeRail, anyRunning, isOpen, onToggle, onOpen, onSelect, onClose }: CategoryButtonProps) {
  const nav = useNavigationTranslation()
  const Icon = CATEGORY_ICONS[cat.key] ?? Wrench
  const allItems = cat.groups.flatMap((g) => g.items)
  const anyActive = allItems.some((item) => item.id === activeRail)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const handleClick = () => {
    if (cat.directItem) {
      onSelect(cat.directItem)
      onClose()
      return
    }
    onToggle()
  }

  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <button
        ref={triggerRef}
        data-rail-control
        aria-haspopup={cat.directItem ? undefined : 'menu'}
        aria-expanded={cat.directItem ? undefined : isOpen}
        aria-controls={cat.directItem ? undefined : `rail-menu-${cat.key}`}
        title={nav(cat.label)}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight' || cat.directItem) return
          event.preventDefault()
          onOpen()
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`#rail-menu-${cat.key} [role="menuitem"]`)?.focus())
        }}
        className={cn(
          'relative flex h-11 w-11 flex-col items-center justify-center gap-[2px] rounded-xl',
          'transition-[background-color,color,box-shadow] duration-200 ease-out',
          isOpen || anyActive
            ? 'border border-accent/25 bg-accent/12 text-text-1 shadow-lg shadow-accent/10'
            : 'border border-transparent text-text-3 hover:border-border-2/70 hover:bg-surface-2/70 hover:text-text-1',
          anyRunning && !isOpen && !anyActive && 'text-success',
        )}
      >
        {(isOpen || anyActive) && (
          <span className="absolute -left-[7px] top-2 bottom-2 w-[3px] rounded-r-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
        )}
        <Icon size={20} strokeWidth={1.75} />
        {anyRunning && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-surface-0 animate-pulse" />
        )}
      </button>

      {isOpen && !cat.directItem && (
        <Flyout
          cat={cat}
          activeRail={activeRail}
          onSelect={onSelect}
          onClose={onClose}
          onFocusTrigger={() => triggerRef.current?.focus()}
        />
      )}
    </div>
  )
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

export function Rail() {
  const tr = useUiTranslation()
  const activeRail = useAppStore((s) => s.activeRail)
  const devToolsVisible = useAppStore((s) => s.devToolsVisible)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const websocketRunning = useAppStore((s) => s.websocketRunning)
  const sseRunning = useAppStore((s) => s.sseRunning)
  const browserRunning = useAppStore((s) => s.browserRunning)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const toggleDevTools = useAppStore((s) => s.toggleDevTools)
  const appIcon = useAppIcon()

  const features = useSettingsStore((s) => s.settings.features)

  const [openKey, setOpenKey] = useState<string | null>(null)
  const railRef = useRef<HTMLElement>(null)

  // Click outside → close flyout
  useEffect(() => {
    if (!openKey) return
    const handler = (e: MouseEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        setOpenKey(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openKey])

  const toggle = (key: string) => setOpenKey(prev => prev === key ? null : key)

  const handleRailKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-rail-control]') : null
    if (!target) return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-rail-control]'))
    const nextIndex = nextRovingFocusIndex(controls.indexOf(target), controls.length, event.key)
    if (nextIndex === null) return
    event.preventDefault()
    controls[nextIndex]?.focus()
  }

  const runningMap: Record<string, boolean> = {
    api:       mockRunning || proxyRunning,
    protocols: websocketRunning || sseRunning,
    infra:     false,
    debug:     browserRunning,
    data:      false,
  }

  const visibleCategories = CATEGORIES.map((cat) => ({
    ...cat,
    groups: cat.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.id === 'plugins' && !features.pluginsEnabled) return false
        if (item.id === 'scenarios' && !features.dailyScenariosEnabled) return false
        if (!isFeatureVisible(item.id, features)) return false
        return true
      }),
    })).filter((group) => group.items.length > 0),
  })).filter((cat) => cat.groups.length > 0)

  return (
    <nav
      ref={railRef}
      data-app-rail
      aria-label={tr('Primary navigation')}
      onKeyDown={handleRailKeyDown}
      className="m-2 mr-0 flex w-14 flex-shrink-0 self-stretch flex-col items-center gap-0.5 overflow-visible rounded-2xl border border-border-2 bg-surface-0/95 py-2.5 shadow-xl shadow-black/20"
    >
      {/* Logo → Home */}
      <button
        data-rail-control
        onClick={() => { setActiveRail('welcome'); setOpenKey(null) }}
        className={cn(
          'mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-transparent transition-all',
          activeRail === 'welcome'
            ? 'border-accent/25 bg-accent/10 shadow-lg shadow-accent/10'
            : 'hover:border-border-2/70 hover:bg-surface-2/70',
        )}
        title={tr('Home')}
      >
        <img src={appIcon} alt="adOmnia" className="h-8 w-8 object-contain" />
      </button>

      {visibleCategories.map((cat) => (
          <CategoryButton
            key={cat.key}
            cat={cat}
            activeRail={activeRail}
            anyRunning={runningMap[cat.key]}
            isOpen={openKey === cat.key}
            onToggle={() => toggle(cat.key)}
            onOpen={() => setOpenKey(cat.key)}
            onSelect={setActiveRail}
            onClose={() => setOpenKey(null)}
          />
      ))}

      {/* Dev Log Toggle — dev-only; kept with the tools so Settings remains last. */}
      {import.meta.env.DEV && (
        <button
          data-rail-control
          onClick={toggleDevTools}
          title={tr('Toggle Dev Logs')}
          className={cn(
            'group/btn relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all',
            devToolsVisible
              ? 'border-accent/25 bg-accent/12 text-accent shadow-lg shadow-accent/10'
              : 'border-transparent text-text-3 hover:border-border-2/70 hover:bg-surface-2/70 hover:text-text-1',
          )}
        >
          <span className={cn(
            'absolute left-full z-50 ml-3 whitespace-nowrap rounded border border-border-2 bg-surface-2 px-2 py-1 text-[10px] text-text-1 shadow-lg',
            'pointer-events-none opacity-0 transition-opacity group-hover/btn:opacity-100',
          )}>
            {tr('Dev Logs')}
          </span>
          <SquareTerminal size={19} strokeWidth={1.75} />
        </button>
      )}

      <div className="flex-1" />
      <div className="mb-2 h-px w-9 bg-border-2/70" aria-hidden="true" />

      {/* Settings */}
      <button
        data-rail-control
        onClick={() => { setActiveRail('settings'); setOpenKey(null) }}
        className={cn(
          'group/btn relative mb-0.5 flex h-11 w-11 items-center justify-center rounded-xl border transition-all',
          activeRail === 'settings'
            ? 'border-accent/25 bg-accent/12 text-text-1 shadow-lg shadow-accent/10'
            : 'border-transparent text-text-3 hover:border-border-2/70 hover:bg-surface-2/70 hover:text-text-1',
        )}
      >
        {activeRail === 'settings' && (
          <span className="absolute -left-[7px] top-2 bottom-2 w-[3px] rounded-r-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />
        )}
        <Settings size={21} strokeWidth={1.75} />
        <span className={cn(
          'absolute left-full ml-3 px-2 py-1 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 whitespace-nowrap z-50',
          'opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none shadow-lg',
        )}>
          {tr('Settings')}
        </span>
      </button>

    </nav>
  )
}
