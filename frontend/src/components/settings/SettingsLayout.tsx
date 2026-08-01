import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5 border-b border-border-1 pb-4">
      <h2 className="text-base font-semibold tracking-tight text-text-1">{title}</h2>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-text-4">{subtitle}</p>
    </div>
  )
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 overflow-hidden rounded-lg border border-border-2 bg-surface-1 px-3', className)}>
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}

export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-status-err/30 bg-status-err/5 px-3">
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}
