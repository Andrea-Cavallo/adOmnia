import type { ReactNode } from 'react'
import { ArrowLeftRight, Cpu, Hourglass, Lock, Moon, Network, Play, Split, Users, type LucideIcon } from 'lucide-react'

export interface StateMeta {
  label: string
  icon: LucideIcon
  /** Colore del testo e del pallino, dai token di stato del tema. */
  tone: string
  dot: string
}

/** Presentazione degli stati prodotti dal backend (internal/goide/debug_goroutines.go). */
export const GOROUTINE_STATES: Record<string, StateMeta> = {
  running: { label: 'Running', icon: Play, tone: 'text-success', dot: 'bg-success' },
  'chan receive': { label: 'Chan receive', icon: ArrowLeftRight, tone: 'text-warning', dot: 'bg-warning' },
  'chan send': { label: 'Chan send', icon: ArrowLeftRight, tone: 'text-warning', dot: 'bg-warning' },
  select: { label: 'Select', icon: Split, tone: 'text-warning', dot: 'bg-warning' },
  mutex: { label: 'Mutex', icon: Lock, tone: 'text-danger', dot: 'bg-danger' },
  waitgroup: { label: 'WaitGroup', icon: Users, tone: 'text-warning', dot: 'bg-warning' },
  cond: { label: 'Cond', icon: Hourglass, tone: 'text-warning', dot: 'bg-warning' },
  sleep: { label: 'Sleep', icon: Moon, tone: 'text-info', dot: 'bg-info' },
  'io wait': { label: 'I/O wait', icon: Network, tone: 'text-info', dot: 'bg-info' },
  syscall: { label: 'Syscall', icon: Cpu, tone: 'text-info', dot: 'bg-info' },
  waiting: { label: 'Waiting', icon: Hourglass, tone: 'text-text-3', dot: 'bg-text-4' },
}

export function stateMeta(state: string): StateMeta {
  return GOROUTINE_STATES[state] ?? GOROUTINE_STATES.waiting
}

export function StateBadge({ state, compact }: { state: string; compact?: boolean }) {
  const meta = stateMeta(state)
  const Icon = meta.icon
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3/70 font-medium ${meta.tone} ${compact ? 'px-1.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]'}`}>
      <Icon size={compact ? 10 : 11} aria-hidden="true" />{meta.label}
    </span>
  )
}

export function StateDot({ state }: { state: string }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${stateMeta(state).dot}`} aria-hidden="true" />
}

/** Colore del valore per tipo, come nei debugger JetBrains: stringhe, numeri, booleani e nil. */
export function valueTone(value: string): string {
  if (/^".*"$/s.test(value) || /^'.'$/.test(value)) return 'text-success'
  if (/^-?\d/.test(value)) return 'text-info'
  if (value === 'true' || value === 'false') return 'text-accent'
  if (value === 'nil' || value === '<nil>') return 'text-text-4'
  return 'text-text-1'
}

export function PaneHeader({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 px-3">
      <span className="text-[12px] font-semibold text-text-2">{title}</span>
      {count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[10.5px] text-text-3">{count}</span>}
      <div className="ml-auto flex min-w-0 items-center gap-1">{children}</div>
    </div>
  )
}

/** "service.go:84" da un percorso relativo o assoluto. */
export function shortLocation(path: string | undefined, line: number | undefined): string {
  if (!path) return ''
  return `${path.split(/[\\/]/).pop()}:${line ?? 0}`
}
