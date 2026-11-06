import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function MiniButton({ children, onClick, disabled, active, title }: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors disabled:opacity-35',
        active ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border-2 bg-surface-1 text-text-2 hover:bg-surface-2 hover:text-text-1',
      )}
    >
      {children}
    </button>
  )
}

/** A labelled checkbox, the same control the REST editors use for on/off settings. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-text-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 rounded accent-accent" />
      <span>{label}</span>
    </label>
  )
}

export function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(min, Math.floor(value) || min), max)
}

export function NumberField({ label, value, min = 1, max, onChange, suffix }: { label: string; value: number; min?: number; max: number; onChange: (value: number) => void; suffix?: string }) {
  return (
    <label className="flex items-center gap-2 text-[11.5px] text-text-3">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clampInt(Number(event.target.value), min, max))}
        className="h-7 w-16 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent/50"
      />
      {suffix && <span className="text-text-4">{suffix}</span>}
    </label>
  )
}

/** A titled block inside a composer section, same rhythm as the REST editors. */
export function SectionBlock({ title, hint, children, right }: { title: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-border-1 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{title}</h3>
        {right && <div className="ml-auto flex items-center gap-1.5">{right}</div>}
      </div>
      {hint && <p className="mb-2 text-[11px] leading-relaxed text-text-4">{hint}</p>}
      {children}
    </section>
  )
}
