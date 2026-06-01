import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3 pb-2 border-b border-border-1">
      <h2 className="text-sm font-semibold text-text-1">{title}</h2>
      <p className="text-[10px] text-text-4 mt-0.5">{subtitle}</p>
    </div>
  )
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('bg-surface-1 border border-border-2 rounded-md p-3 mb-3', className)}>
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}

export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <div className="border border-status-err/30 rounded-md p-3 mb-3 bg-status-err/5">
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}
