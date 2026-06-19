import { useState, useRef, useCallback } from 'react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useAppIcon } from '@/lib/brandAssets'
import { cn } from '@/lib/utils'
import {
  Send,
  LayoutList,
  Shield,
  Server,
  Radio,
  Bug,
  Container,
  Wrench,
  FileText,
  FileCode,
  Database,
  Braces,
  Zap,
  BarChart2,
  Activity,
  Lock,
  Puzzle,
  Settings,
  GitBranch,
} from 'lucide-react'

interface DockItemDef {
  id: RailItem
  icon: React.ElementType
  label: string
  color?: string
}

const DOCK_ITEMS: DockItemDef[] = [
  { id: 'collections', icon: LayoutList,     label: 'Collections',      color: '#60a5fa' },
  { id: 'websocket',   icon: Zap,            label: 'WebSocket',        color: '#22c55e' },
  { id: 'sse',         icon: Radio,          label: 'SSE Client',       color: '#fb7185' },
  { id: 'broker',      icon: Server,         label: 'Broker Studio',    color: '#fb923c' },
  { id: 'mock',        icon: Server,         label: 'Mock Server',      color: '#4ade80' },
  { id: 'proxy',       icon: Shield,         label: 'Proxy',            color: '#facc15' },
  { id: 'browser',     icon: Bug,            label: 'Browser Debug',    color: '#f472b6' },
  { id: 'dockerlab',   icon: Container,      label: 'Docker Lab',       color: '#0ea5e9' },
  { id: 'grpc',        icon: Send,           label: 'gRPC',             color: '#a78bfa' },
  { id: 'soap',        icon: FileCode,       label: 'SOAP',             color: '#38bdf8' },
  { id: 'flows',       icon: GitBranch,      label: 'Flows',            color: '#c084fc' },
  { id: 'jsontools',   icon: Braces,         label: 'JSON Tools',       color: '#34d399' },
  { id: 'xmltools',    icon: FileCode,       label: 'XML Tools',        color: '#fbbf24' },
  { id: 'utils',       icon: Wrench,         label: 'Power Tools',      color: '#f87171' },
  { id: 'har',         icon: BarChart2,      label: 'HAR Viewer',       color: '#f97316' },
  { id: 'observe',     icon: Activity,       label: 'Observability',    color: '#38bdf8' },
  { id: 'database',    icon: Database,       label: 'Database',         color: '#6366f1' },
  { id: 'storage',     icon: Database,       label: 'Storage',          color: '#94a3b8' },
  { id: 'markdown',    icon: FileText,       label: 'Document Studio',  color: '#a3a3a3' },
  { id: 'vault',       icon: Lock,           label: 'Vault',            color: '#eab308' },
  { id: 'plugins',     icon: Puzzle,         label: 'Plugins',          color: '#f59e0b' },
  { id: 'settings',    icon: Settings,       label: 'Settings',         color: '#94a3b8' },
]

const BASE_SIZE = 40
const MAX_SIZE = 64
const MAGNIFY_RANGE = 120

function getScale(distance: number): number {
  if (distance > MAGNIFY_RANGE) return 1
  const ratio = 1 - distance / MAGNIFY_RANGE
  return 1 + ratio * ((MAX_SIZE - BASE_SIZE) / BASE_SIZE)
}

export function Dock() {
  const activeRail = useAppStore((s) => s.activeRail)
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const mockRunning = useAppStore((s) => s.mockRunning)
  const proxyRunning = useAppStore((s) => s.proxyRunning)
  const websocketRunning = useAppStore((s) => s.websocketRunning)
  const sseRunning = useAppStore((s) => s.sseRunning)
  const browserRunning = useAppStore((s) => s.browserRunning)
  const appIcon = useAppIcon()

  const dockRef = useRef<HTMLDivElement>(null)
  const [mouseY, setMouseY] = useState<number | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const isRunning = (id: RailItem) => {
    if (id === 'mock') return mockRunning
    if (id === 'proxy') return proxyRunning
    if (id === 'websocket') return websocketRunning
    if (id === 'sse') return sseRunning
    if (id === 'browser') return browserRunning
    return false
  }

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = dockRef.current?.getBoundingClientRect()
    if (rect) setMouseY(e.clientY - rect.top)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMouseY(null)
    setHoveredIdx(null)
  }, [])

  return (
    <nav
      ref={dockRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="flex-shrink-0 flex flex-col items-center py-2 px-1 relative z-10 bg-black/60 backdrop-blur-md border-r border-white/[0.06]"
      style={{ width: '62px' }}
    >
      {/* Home button */}
      <button
        onClick={() => setActiveRail('welcome')}
        className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center mb-2 transition-all',
          activeRail === 'welcome' ? 'bg-accent/20 ring-1 ring-accent/40' : 'hover:bg-white/10',
        )}
        title="Home"
      >
        <img src={appIcon} alt="adOmnia" className="w-7 h-7 object-contain" />
      </button>

      <div className="w-8 h-px bg-white/10 mb-2" />

      {/* Dock items */}
      <div className="flex-1 flex flex-col items-center gap-[2px] overflow-y-auto overflow-x-visible no-scrollbar">
        {DOCK_ITEMS.map((item, idx) => {
          const el = itemRefs.current[idx]
          let scale = 1
          if (mouseY !== null && el && dockRef.current) {
            const itemRect = el.getBoundingClientRect()
            const dockRect = dockRef.current.getBoundingClientRect()
            const itemCenterY = itemRect.top + itemRect.height / 2 - dockRect.top
            const distance = Math.abs(mouseY - itemCenterY)
            scale = getScale(distance)
          }

          const Icon = item.icon
          const active = activeRail === item.id
          const running = isRunning(item.id)
          const size = BASE_SIZE * scale

          return (
            <button
              key={item.id}
              ref={(el) => { itemRefs.current[idx] = el }}
              onClick={() => setActiveRail(item.id)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                'relative flex items-center justify-center rounded-xl transition-colors duration-100',
                active
                  ? 'bg-white/15 shadow-lg shadow-accent/20'
                  : 'hover:bg-white/10',
              )}
              style={{
                width: `${size}px`,
                height: `${size}px`,
                transition: mouseY !== null ? 'width 0.15s ease, height 0.15s ease' : 'all 0.3s ease',
              }}
              title={item.label}
            >
              <Icon
                size={16 * scale}
                style={{ color: item.color ?? 'var(--color-text-1)' }}
                className="transition-none"
              />
              {running && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-success rounded-full border-2 border-black/50 animate-pulse" />
              )}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-white rounded-r" />
              )}
              {/* Tooltip */}
              {hoveredIdx === idx && (
                <span className="absolute left-full ml-3 px-2.5 py-1.5 bg-surface-2/95 backdrop-blur border border-border-2 rounded-lg text-[11px] text-text-1 whitespace-nowrap z-50 shadow-xl pointer-events-none">
                  {item.label}
                  {running ? ' (running)' : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
