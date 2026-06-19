import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'
import { useAppIcon } from '@/lib/brandAssets'
import {
  Send, LayoutList, Shield, Server, Radio, Bug, Container, Network,
  Wrench, FileText, FileCode, Database, Braces, ChevronRight, FolderOpen,
  Lock, Puzzle, Settings, GitBranch,
  Zap, BarChart2, Activity, HardDrive, History, Layers,
  BookOpen,
} from 'lucide-react'

interface SubItem {
  id: RailItem
  icon: React.ElementType
  label: string
}

interface SubGroup {
  title: string
  items: SubItem[]
}

interface CategoryDef {
  key: string
  label: string
  icon: React.ElementType
  code: string
  directItem?: RailItem
  groups: SubGroup[]
}

function Soap95Icon({ size = 12 }: { size?: number }) {
  return <img src="/icon95.png" alt="" style={{ width: size, height: size }} className="object-contain" />
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'api', label: 'API Core', icon: Send, code: 'API',
    groups: [
      { title: 'Requests', items: [
        { id: 'collections', icon: LayoutList, label: 'API Workspace' },
        { id: 'scenarios',   icon: Layers,     label: 'Daily Scenarios' },
        { id: 'history',     icon: History,    label: 'Request History' },
        { id: 'flows',       icon: GitBranch,  label: 'Flows' },
      ]},
      { title: 'Design', items: [
        { id: 'apidocs', icon: BookOpen, label: 'API Docs / Swagger' },
      ]},
    ],
  },
  {
    key: 'streaming', label: 'Protocols & Streaming', icon: Radio, code: 'PROTO',
    groups: [
      { title: 'Streaming', items: [
        { id: 'websocket', icon: Zap,    label: 'WebSocket' },
        { id: 'sse',       icon: Radio,  label: 'SSE Client' },
        { id: 'broker',    icon: Server, label: 'Broker Studio' },
      ]},
      { title: 'Protocols', items: [
        { id: 'grpc',  icon: Send,     label: 'gRPC Client' },
        { id: 'soap',  icon: Soap95Icon, label: 'SOAP Studio' },
        { id: 'mcp',   icon: Network,  label: 'MCP Client' },
      ]},
    ],
  },
  {
    key: 'infra', label: 'Infrastructure & Simulation', icon: Server, code: 'INFRA',
    groups: [
      { title: 'Simulation', items: [
        { id: 'mock',      icon: Server,    label: 'Mock Server' },
        { id: 'proxy',     icon: Shield,    label: 'Proxy Interceptor' },
      ]},
    ],
  },
  {
    key: 'debug', label: 'Browser Debug', icon: Bug, code: 'DEBUG',
    groups: [
      { title: 'Debugging', items: [
        { id: 'browser',  icon: Bug,   label: 'Browser Debug & Net Tools' },
      ]},
    ],
  },
  {
    key: 'data', label: 'Local Data', icon: Database, code: 'DATA',
    groups: [
      { title: 'Data', items: [
        { id: 'database', icon: Database,  label: 'Database Studio' },
        { id: 'storage',  icon: HardDrive, label: 'Storage Explorer' },
        { id: 'vault',    icon: Lock,      label: 'Vault' },
      ]},
    ],
  },
  {
    key: 'powertools', label: 'Power Tools', icon: Wrench, code: 'PWR',
    directItem: 'powertools',
    groups: [
      { title: 'Data Tools', items: [
        { id: 'jsontools',   icon: Braces,   label: 'JSON Tools' },
        { id: 'xmltools',    icon: FileCode, label: 'XML Tools' },
        { id: 'har',         icon: BarChart2, label: 'HAR Viewer' },
        { id: 'observe',     icon: Activity,  label: 'Observability' },
        { id: 'secretscanner', icon: Shield,  label: 'Secret Scanner' },
      ]},
      { title: 'Utilities', items: [
        { id: 'powertools',  icon: Wrench,  label: 'All Utilities' },
        { id: 'dockerlab',   icon: Container, label: 'Docker Lab' },
      ]},
      { title: 'Extensibility', items: [
        { id: 'plugins', icon: Puzzle, label: 'Plugins' },
      ]},
    ],
  },
  {
    key: 'markdown', label: 'Document Studio', icon: FileText, code: 'DOC',
    groups: [
      { title: 'Documents & Diagrams', items: [
        { id: 'markdown',  icon: FileText,  label: 'Markdown Notes' },
        { id: 'mermaid',   icon: GitBranch, label: 'Mermaid Diagrams' },
        { id: 'latex',     icon: FileCode,  label: 'LaTeX Studio' },
        { id: 'pdfeditor', icon: FileText,  label: 'PDF Editor & Sign' },
      ]},
    ],
  },
  {
    key: 'gitsync', label: 'Git Sync', icon: GitBranch, code: 'GIT',
    directItem: 'gitsync',
    groups: [
      { title: 'Sync', items: [
        { id: 'gitsync', icon: GitBranch, label: 'Git Sync' },
      ]},
    ],
  },
]

const RAIL_MAGNIFY_RANGE = 82
const RAIL_MAX_SCALE = 1.34

function getRailMagnifyScale(distance: number): number {
  if (distance >= RAIL_MAGNIFY_RANGE) return 1
  const proximity = 1 - distance / RAIL_MAGNIFY_RANGE
  const eased = 1 - Math.pow(1 - proximity, 3)
  return 1 + eased * (RAIL_MAX_SCALE - 1)
}

// ─── Flyout panel (click-based, all items visible inline) ─────────────────────

interface FlyoutProps {
  cat: CategoryDef
  activeRail: RailItem
  onSelect: (id: RailItem) => void
  onClose: () => void
}

function Flyout({ cat, activeRail, onSelect, onClose }: FlyoutProps) {
  return (
    <div className="absolute left-full top-0 ml-2 w-52 bg-surface-1 border border-border-1 rounded-xl shadow-2xl z-50 py-2 overflow-hidden">
      <div className="px-3 pt-1 pb-2 border-b border-border-1/60">
        <span className="text-[10px] font-bold text-accent tracking-wide uppercase">{cat.label}</span>
      </div>

      {cat.groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="h-px bg-border-1/50 my-1 mx-3" />}
          <div className="px-3 pt-2 pb-0.5">
            <span className="text-[9px] font-semibold text-text-4 tracking-wider uppercase flex items-center gap-1">
              <FolderOpen size={9} />
              {group.title}
            </span>
          </div>
          {group.items.map((item) => {
            const active = activeRail === item.id
            return (
              <button
                key={item.id}
                onClick={() => { onSelect(item.id); onClose() }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left',
                  active
                    ? 'text-text-1 bg-accent/10'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
                )}
              >
                <item.icon size={12} />
                <span className="flex-1">{item.label}</span>
                {active && <ChevronRight size={10} className="text-accent" />}
              </button>
            )
          })}
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
  magnifyScale: number
  buttonRef?: (node: HTMLDivElement | null) => void
  onToggle: () => void
  onSelect: (id: RailItem) => void
  onClose: () => void
}

function CategoryButton({ cat, activeRail, anyRunning, isOpen, magnifyScale, buttonRef, onToggle, onSelect, onClose }: CategoryButtonProps) {
  const Icon = cat.icon
  const showRailIconsOnly = useSettingsStore((s) => s.settings.appearance.showRailIconsOnly)
  const allItems = cat.groups.flatMap((g) => g.items)
  const anyActive = allItems.some((item) => item.id === activeRail)
  const handleClick = () => {
    if (cat.directItem) {
      onSelect(cat.directItem)
      onClose()
      return
    }
    onToggle()
  }

  return (
    <div ref={buttonRef} className="relative h-12 w-12 flex items-center justify-center">
      <button
        title={cat.label}
        onClick={handleClick}
        className={cn(
          'w-11 h-11 rounded-lg flex flex-col items-center justify-center gap-[2px] relative will-change-transform',
          'transition-[transform,background-color,color,box-shadow] duration-200 ease-out',
          isOpen || anyActive
            ? 'text-accent bg-accent/10'
            : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
          anyRunning && !isOpen && !anyActive && 'text-success',
        )}
        style={{
          transform: `translateX(${(magnifyScale - 1) * 10}px) scale(${magnifyScale})`,
          transformOrigin: 'left center',
          zIndex: Math.round(magnifyScale * 10),
        }}
      >
        {(isOpen || anyActive) && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-accent rounded-r" />
        )}
        <Icon size={16} className="transition-transform duration-200 ease-out" />
        {!showRailIconsOnly && (
          <span className="text-[7px] font-semibold leading-none tracking-wider opacity-60 transition-opacity duration-200">
            {cat.code}
          </span>
        )}
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
        />
      )}
    </div>
  )
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

export function Rail() {
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
  const [mouseY, setMouseY] = useState<number | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])

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

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setMouseY(event.clientY)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMouseY(null)
  }, [])

  const runningMap: Record<string, boolean> = {
    api:       false,
    streaming: websocketRunning || sseRunning,
    infra:     mockRunning || proxyRunning,
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
        return true
      }),
    })).filter((group) => group.items.length > 0),
  })).filter((cat) => cat.groups.length > 0)

  return (
    <nav
      ref={railRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="w-16 flex-shrink-0 bg-surface-0 border-r border-border-1 flex flex-col items-center py-3 gap-0.5 overflow-visible"
    >
      {/* Logo → Home */}
      <button
        onClick={() => { setActiveRail('welcome'); setOpenKey(null) }}
        className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center mb-4 transition-all',
          activeRail === 'welcome'
            ? 'bg-accent/10 ring-1 ring-accent/30'
            : 'hover:bg-surface-2',
        )}
        title="Home"
      >
        <img src={appIcon} alt="adOmnia" className="w-7 h-7 object-contain" />
      </button>

      {visibleCategories.map((cat, index) => {
        const node = itemRefs.current[index]
        const centerY = node ? node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2 : null
        const magnifyScale = mouseY !== null && centerY !== null
          ? getRailMagnifyScale(Math.abs(mouseY - centerY))
          : 1

        return (
          <CategoryButton
            key={cat.key}
            buttonRef={(node) => { itemRefs.current[index] = node }}
            cat={cat}
            activeRail={activeRail}
            anyRunning={runningMap[cat.key]}
            isOpen={openKey === cat.key}
            magnifyScale={magnifyScale}
            onToggle={() => toggle(cat.key)}
            onSelect={setActiveRail}
            onClose={() => setOpenKey(null)}
          />
        )
      })}

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => { setActiveRail('settings'); setOpenKey(null) }}
        className={cn(
          'w-11 h-11 rounded-lg flex flex-col items-center justify-center gap-[2px] relative transition-all group/btn mb-1',
          activeRail === 'settings'
            ? 'text-text-1 bg-surface-2 shadow-sm'
            : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
        )}
      >
        {activeRail === 'settings' && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-text-1 rounded-r" />
        )}
        <Settings size={16} />
        <span className={cn(
          'absolute left-full ml-3 px-2 py-1 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 whitespace-nowrap z-50',
          'opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none shadow-lg',
        )}>
          Settings
        </span>
      </button>

      {/* Dev Log Toggle — dev-only */}
      {import.meta.env.DEV && (
        <button
          onClick={toggleDevTools}
          title="Toggle Dev Logs"
          className={cn(
            'w-11 h-11 rounded-lg flex flex-col items-center justify-center gap-[2px] relative transition-all group/btn mb-1',
            devToolsVisible
              ? 'text-accent bg-accent/10 shadow-sm'
              : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
          )}
        >
          <span className={cn(
            'absolute left-full ml-3 px-2 py-1 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 whitespace-nowrap z-50',
            'opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none shadow-lg',
          )}>
            Dev Logs
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="text-[7px] font-semibold leading-none tracking-wider opacity-60">LOG</span>
        </button>
      )}
    </nav>
  )
}
