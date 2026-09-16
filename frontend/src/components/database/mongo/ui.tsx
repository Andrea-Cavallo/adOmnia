import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { DbResult } from '../dbShared'
import type { BsonDoc } from './bson'

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const firstDocument = (result: DbResult): BsonDoc => (result.documents?.[0] ?? {}) as BsonDoc

export function ErrorBox({ message, className }: { message: string; className?: string }) {
  if (!message) return null
  return <div role="alert" className={cn('rounded-md border border-error/30 bg-error/10 px-3 py-2 font-mono text-[11.5px] text-error', className)}>{message}</div>
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="grid h-full min-h-[220px] place-items-center p-6 text-center">
      <div>
        <div className="text-[13px] font-semibold text-text-1">{title}</div>
        <div className="mx-auto mt-1 max-w-xs text-[11.5px] text-text-3">{text}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}

export const primaryButton = 'flex h-8 flex-none items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40'
export const secondaryButton = 'flex h-8 flex-none items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40'
export const fieldInput = 'h-8 rounded-md border border-border-2 bg-surface-0 px-2.5 text-[11.5px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/60'

export function formatBytes(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = n
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Reads a number that may still be wrapped in canonical Extended JSON. */
export function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const inner = Object.values(value as Record<string, unknown>)[0]
    const n = Number(inner)
    return Number.isFinite(n) ? n : null
  }
  return null
}
