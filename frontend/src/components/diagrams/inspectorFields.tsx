/**
 * Small form controls of the Diagram Studio inspector. Text and numbers commit on blur or Enter,
 * so one edit is one undo step, not one step per key.
 */
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="diagram-inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn('diagram-field', wide && 'diagram-field--wide')}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function TextField({ value, onCommit, multiline, placeholder, mono }: {
  value: string
  onCommit: (value: string) => void
  multiline?: boolean
  placeholder?: string
  mono?: boolean
}) {
  const [draft, setDraft] = useState(value)
  // Follow the outside value (undo, another selection) without an effect.
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setDraft(value) }
  const commit = () => { if (draft !== value) onCommit(draft) }
  const common = {
    value: draft,
    placeholder,
    className: cn('diagram-input', mono && 'font-mono'),
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
  }
  return multiline
    ? <textarea {...common} rows={4} onKeyDown={(event) => { if (event.key === 'Escape') setDraft(value) }} />
    : <input {...common} onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') setDraft(value) }} />
}

export function NumberField({ value, onCommit, min, max, step = 1 }: { value: number; onCommit: (value: number) => void; min: number; max: number; step?: number }) {
  const [draft, setDraft] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setDraft(String(value)) }
  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    const clamped = Math.min(max, Math.max(min, parsed))
    setDraft(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      type="number"
      className="diagram-input"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit() }}
    />
  )
}

export function SelectField<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <select className="diagram-input" value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="diagram-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** A color: theme default (empty), one of the swatches, or any custom color. */
export function ColorField({ value, swatches, onChange }: { value: string; swatches: ReadonlyArray<{ id: string; label: string; color: string }>; onChange: (value: string) => void }) {
  return (
    <div className="diagram-colors">
      {swatches.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          title={swatch.label}
          aria-label={swatch.label}
          aria-pressed={value === swatch.color}
          className={cn('diagram-swatch', !swatch.color && 'diagram-swatch--theme')}
          style={swatch.color ? { background: swatch.color } : undefined}
          onClick={() => onChange(swatch.color)}
        />
      ))}
      <input type="color" className="diagram-swatch-custom" value={value || '#888888'} onChange={(event) => onChange(event.target.value)} title="Custom color" aria-label="Custom color" />
    </div>
  )
}
