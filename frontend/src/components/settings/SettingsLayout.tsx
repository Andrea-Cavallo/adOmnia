import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5 border-b border-border-1 pb-4">
      <h2 className="nothing-studio-title settings-section-title text-text-1">{title}</h2>
      <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-text-3">{subtitle}</p>
    </div>
  )
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('settings-group mb-5 overflow-hidden border-b border-border-1', className)}>
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}

export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <div className="settings-danger mb-5 overflow-hidden border border-status-err/30 px-3">
      <div className="flex flex-col divide-y divide-border-1">{children}</div>
    </div>
  )
}
