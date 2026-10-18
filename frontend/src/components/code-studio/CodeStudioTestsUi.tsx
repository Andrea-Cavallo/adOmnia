import { useRef, useState, type ComponentType, type ReactNode } from 'react'
import { CheckCircle2, ChevronDown, CircleDashed, Clock3, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { SuiteStatus } from '@/lib/code-studio/testSuites'

interface StatusStyle {
  label: string
  className: string
  icon: ComponentType<{ size?: number; className?: string }>
}

const STATUS_STYLES: Record<SuiteStatus, StatusStyle> = {
  passed: { label: 'Passed', className: 'bg-success/12 text-success', icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'bg-danger/12 text-danger', icon: XCircle },
  running: { label: 'Running', className: 'bg-accent/12 text-accent', icon: Loader2 },
  queued: { label: 'Queued', className: 'bg-surface-3 text-text-3', icon: Clock3 },
  stopped: { label: 'Stopped', className: 'bg-warning/12 text-warning', icon: MinusCircle },
  notrun: { label: 'Not run', className: 'bg-surface-3 text-text-4', icon: CircleDashed },
}

export function statusLabel(status: SuiteStatus): string {
  return STATUS_STYLES[status].label
}

/** Pillola di stato di una suite: stessa forma e gerarchia in tabella e nel dettaglio. */
export function StatusPill({ status }: { status: SuiteStatus }) {
  const style = STATUS_STYLES[status]
  const Icon = style.icon
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[12px] font-medium ${style.className}`}>
      <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {style.label}
    </span>
  )
}

export function LanguageChip({ label }: { label: string }) {
  return <span className="inline-flex h-[22px] items-center rounded-md border border-border-1 bg-surface-2 px-2 text-[12px] font-medium text-text-2">{label}</span>
}

interface SplitButtonProps {
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  variant: 'primary' | 'secondary'
  onMain: () => void
  items: ContextMenuItem[]
  onItem: (id: string) => void
  disabled?: boolean
  mainTitle?: string
  menuLabel: string
  className?: string
}

/** Azione principale con un menu di varianti a fianco, come "Run ▾" e "Run All ▾" del mock. */
export function SplitButton({ label, icon: Icon, variant, onMain, items, onItem, disabled, mainTitle, menuLabel, className = '' }: SplitButtonProps) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const tone = variant === 'primary'
    ? 'bg-accent text-on-accent hover:bg-accent-hover'
    : 'border border-border-2 bg-surface-2 text-text-1 hover:border-accent hover:bg-surface-3'
  const divider = variant === 'primary' ? 'border-l border-on-accent/25' : 'border-l border-border-2'
  const open = () => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 })
  }
  return (
    <div className={`flex h-10 overflow-hidden rounded-lg text-[14px] font-semibold ${disabled ? 'opacity-40' : ''} ${className}`}>
      <button type="button" disabled={disabled} onClick={onMain} title={mainTitle} className={`flex min-w-0 flex-1 items-center justify-center gap-2 px-4 transition-colors disabled:cursor-not-allowed ${tone}`}>
        <Icon size={15} />
        <span className="truncate">{label}</span>
      </button>
      <button ref={anchor} type="button" disabled={disabled} aria-label={menuLabel} aria-haspopup="menu" onClick={open} className={`grid w-9 shrink-0 place-items-center transition-colors disabled:cursor-not-allowed ${tone} ${divider}`}>
        <ChevronDown size={14} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} appearance="studio" onSelect={(id) => { setMenu(null); onItem(id) }} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** Ciambella con tre archi (passate, fallite, in corso) e il resto neutro: una lettura d'insieme della scheda "Total". */
export function SuiteDonut({ passed, failed, running, total }: { passed: number; failed: number; running: number; total: number }) {
  const radius = 15
  const circumference = 2 * Math.PI * radius
  const arcs: Array<{ value: number; className: string }> = [
    { value: passed, className: 'stroke-success' },
    { value: failed, className: 'stroke-danger' },
    { value: running, className: 'stroke-accent' },
  ]
  let offset = 0
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx="20" cy="20" r={radius} fill="none" strokeWidth="5" className="stroke-surface-4" />
      {total > 0 && arcs.map((arc, index) => {
        if (arc.value === 0) return null
        const length = (arc.value / total) * circumference
        const circle = <circle key={index} cx="20" cy="20" r={radius} fill="none" strokeWidth="5" strokeDasharray={`${Math.max(0, length - 1)} ${circumference}`} strokeDashoffset={-offset} className={arc.className} />
        offset += length
        return circle
      })}
    </svg>
  )
}

export function Tile({ children, tone = 'bg-accent/12 text-accent' }: { children: ReactNode; tone?: string }) {
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>{children}</span>
}
