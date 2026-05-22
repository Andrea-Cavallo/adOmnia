import { useEffect, useRef, useState } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { cn } from '@/lib/utils'
import { useAppIcon } from '@/lib/brandAssets'
import {
  Send, LayoutList, Shield, Server, Radio, Globe, Bug, Container, Network,
  Wrench, FileText, FileCode, Database, Braces, FlaskConical, ChevronRight,
  Lock, FolderOpen, Paintbrush, LayoutTemplate, Puzzle, Settings, GitBranch,
  Play, Zap, BarChart2, Activity, Box, HardDrive,
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
        { id: 'runner',      icon: Play,       label: 'Runner' },
        { id: 'flows',       icon: GitBranch,  label: 'Flows' },
      ]},
      { title: 'Testing', items: [
        { id: 'matrix',   icon: Network,      label: 'Env Matrix' },
        { id: 'testdata', icon: FlaskConical, label: 'Test Data' },
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
        { id: 'kafka', icon: Box,      label: 'Kafka Client' },
      ]},
    ],
  },
  {
    key: 'infra', label: 'Infrastructure & Simulation', icon: Server, code: 'INFRA',
    groups: [
      { title: 'Simulation', items: [
        { id: 'mock',      icon: Server,    label: 'Mock Server' },
        { id: 'proxy',     icon: Shield,    label: 'Proxy Interceptor' },
        { id: 'dockerlab', icon: Container, label: 'Docker Lab' },
      ]},
    ],
  },
  {
    key: 'debug', label: 'Debugging & Analysis', icon: Bug, code: 'DEBUG',
    groups: [
      { title: 'Debugging', items: [
        { id: 'browser',  icon: Bug,   label: 'Browser Debug' },
        { id: 'nettools', icon: Globe, label: 'Net Tools' },
      ]},
      { title: 'Analysis', items: [
        { id: 'har',           icon: BarChart2, label: 'HAR Viewer' },
        { id: 'observe',       icon: Activity,  label: 'Observability' },
        { id: 'secretscanner', icon: Shield,    label: 'Secret Scanner' },
      ]},
    ],
  },
  {
    key: 'data', label: 'Local Data & Workspace', icon: Database, code: 'DATA',
    groups: [
      { title: 'Data', items: [
        { id: 'database', icon: Database,  label: 'Database Studio' },
        { id: 'storage',  icon: HardDrive, label: 'Storage Explorer' },
        { id: 'vault',    icon: Lock,      label: 'Vault' },
      ]},
      { title: 'Workspace', items: [
        { id: 'workspace',  icon: FolderOpen,     label: 'Workspace' },
        { id: 'templates',  icon: LayoutTemplate, label: 'Templates' },
        { id: 'plugins',    icon: Puzzle,         label: 'Plugins' },
        { id: 'themes',     icon: Paintbrush,     label: 'Themes' },
      ]},
    ],
  },
  {
    key: 'powertools', label: 'Power Tools', icon: Wrench, code: 'PWR',
    groups: [
      { title: 'Data Tools', items: [
        { id: 'jsontools',   icon: Braces,   label: 'JSON Tools' },
        { id: 'xmltools',    icon: FileCode, label: 'XML Tools' },
      ]},
      { title: 'Utilities', items: [
        { id: 'powertools',  icon: Wrench,  label: 'All Utilities' },
      ]},
    ],
  },
  {
    key: 'markdown', label: 'Markdown', icon: FileText, code: 'MD',
    groups: [
      { title: 'Editor', items: [
        { id: 'markdown', icon: FileText, label: 'Markdown Editor' },
      ]},
    ],
  },
]

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
  onToggle: () => void
  onSelect: (id: RailItem) => void
  onClose: () => void
}

function CategoryButton({ cat, activeRail, anyRunning, isOpen, onToggle, onSelect, onClose }: CategoryButtonProps) {
  const Icon = cat.icon
  const allItems = cat.groups.flatMap((g) => g.items)
  const anyActive = allItems.some((item) => item.id === activeRail)

  return (
    <div className="relative">
      <button
        title={cat.label}
        onClick={onToggle}
        className={cn(
          'w-11 h-11 rounded-lg flex flex-col items-center justify-center gap-[2px] relative transition-all',
          isOpen || anyActive
            ? 'text-accent bg-accent/10'
            : 'text-text-3 hover:text-text-1 hover:bg-surface-2',
          anyRunning && !isOpen && !anyActive && 'text-success',
        )}
      >
        {(isOpen || anyActive) && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-accent rounded-r" />
        )}
        <Icon size={16} />
        <span className="text-[7px] font-semibold leading-none tracking-wider opacity-60">{cat.code}</span>
        {anyRunning && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-surface-0 animate-pulse" />
        )}
      </button>

      {isOpen && (
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

  const runningMap: Record<string, boolean> = {
    api:       false,
    streaming: websocketRunning || sseRunning,
    infra:     mockRunning || proxyRunning,
    debug:     browserRunning,
    data:      false,
  }

  return (
    <nav ref={railRef} className="w-14 flex-shrink-0 bg-surface-0 border-r border-border-1 flex flex-col items-center py-3 gap-0.5">
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

      {CATEGORIES.map((cat) => (
        <CategoryButton
          key={cat.key}
          cat={cat}
          activeRail={activeRail}
          anyRunning={runningMap[cat.key]}
          isOpen={openKey === cat.key}
          onToggle={() => toggle(cat.key)}
          onSelect={setActiveRail}
          onClose={() => setOpenKey(null)}
        />
      ))}

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

      {/* Dev Log Toggle */}
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
    </nav>
  )
}
