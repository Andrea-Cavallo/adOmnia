import { useState, type ReactNode } from 'react'
import { observer } from 'mobx-react-lite'
import type { DesignSession } from '../adapters/design-session'

type FieldKind = 'text' | 'color' | 'select'

interface Field {
  key: string
  label: string
  kind?: FieldKind
  options?: readonly string[]
  /** Shown only when another style has one of these values (flex and grid controls). */
  when?: { key: string; values: readonly string[] }
}

interface Section {
  title: string
  columns: 1 | 2 | 4
  fields: readonly Field[]
}

const FLEX = { key: 'display', values: ['flex', 'inline-flex'] } as const
const GRID = { key: 'display', values: ['grid', 'inline-grid'] } as const
const DISTRIBUTE = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const

const SECTIONS: readonly Section[] = [
  {
    title: 'Layout', columns: 2, fields: [
      { key: 'display', label: 'Display', kind: 'select', options: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'none'] },
      { key: 'flexDirection', label: 'Direction', kind: 'select', options: ['row', 'column', 'row-reverse', 'column-reverse'], when: FLEX },
      { key: 'justifyContent', label: 'Justify', kind: 'select', options: DISTRIBUTE, when: FLEX },
      { key: 'alignItems', label: 'Align', kind: 'select', options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'], when: FLEX },
      { key: 'flexWrap', label: 'Wrap', kind: 'select', options: ['nowrap', 'wrap'], when: FLEX },
      { key: 'gridTemplateColumns', label: 'Columns', when: GRID },
      { key: 'gridTemplateRows', label: 'Rows', when: GRID },
      { key: 'gap', label: 'Gap' },
    ],
  },
  { title: 'Size', columns: 2, fields: [{ key: 'width', label: 'Width' }, { key: 'height', label: 'Height' }] },
  {
    title: 'Padding', columns: 4, fields: [
      { key: 'paddingTop', label: 'Top' }, { key: 'paddingRight', label: 'Right' }, { key: 'paddingBottom', label: 'Bottom' }, { key: 'paddingLeft', label: 'Left' },
    ],
  },
  {
    title: 'Margin', columns: 4, fields: [
      { key: 'marginTop', label: 'Top' }, { key: 'marginRight', label: 'Right' }, { key: 'marginBottom', label: 'Bottom' }, { key: 'marginLeft', label: 'Left' },
    ],
  },
  {
    title: 'Typography', columns: 2, fields: [
      { key: 'color', label: 'Color', kind: 'color' },
      { key: 'fontSize', label: 'Size' },
      { key: 'fontWeight', label: 'Weight', kind: 'select', options: ['300', '400', '500', '600', '700', '800'] },
      { key: 'lineHeight', label: 'Line height' },
      { key: 'letterSpacing', label: 'Spacing' },
      { key: 'textAlign', label: 'Align', kind: 'select', options: ['left', 'center', 'right', 'justify'] },
    ],
  },
  {
    title: 'Fill and border', columns: 2, fields: [
      { key: 'backgroundColor', label: 'Background', kind: 'color' },
      { key: 'opacity', label: 'Opacity' },
      { key: 'borderWidth', label: 'Border' },
      { key: 'borderStyle', label: 'Style', kind: 'select', options: ['none', 'solid', 'dashed', 'dotted'] },
      { key: 'borderColor', label: 'Border color', kind: 'color' },
      { key: 'borderRadius', label: 'Radius' },
    ],
  },
]

const GRID_COLUMNS: Record<Section['columns'], string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 4: 'grid-cols-4' }
const INPUT = 'h-6 w-full min-w-0 rounded bg-[var(--gs-ground)] px-1.5 font-mono text-[11px] text-text-1 outline-none focus:ring-1 focus:ring-accent disabled:text-text-4'

/** "rgb(255, 0, 0)" or "rgba(…)" → "#ff0000" for the native colour input; anything else → null. */
export function toHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value)
  if (!match) return null
  return `#${match.slice(1, 4).map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0')).join('')}`
}

interface StyleInputProps {
  field: Field
  value: string
  disabled: boolean
  onCommit: (value: string) => void
}

function StyleInput({ field, value, disabled, onCommit }: StyleInputProps) {
  // The draft is local while typing and resets when the element or its value changes (keyed by the caller).
  const [draft, setDraft] = useState(value)
  const commit = (next: string) => {
    const trimmed = next.trim()
    if (trimmed !== '' && trimmed !== value) onCommit(trimmed)
    else setDraft(value)
  }
  if (field.kind === 'select') {
    const options = field.options ?? []
    return (
      <select className={INPUT} value={options.includes(value) ? value : ''} disabled={disabled} aria-label={field.label} onChange={(event) => commit(event.target.value)}>
        {!options.includes(value) && <option value="">{value || '—'}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      {field.kind === 'color' && (
        <input
          type="color" disabled={disabled} value={toHex(value) ?? '#000000'} aria-label={`${field.label} picker`}
          className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border-2 bg-transparent p-0 disabled:cursor-default"
          // The picker fires continuously while dragging: write once, when it closes.
          onChange={(event) => setDraft(event.target.value)} onBlur={(event) => commit(event.target.value)}
        />
      )}
      <input
        className={INPUT} value={draft} disabled={disabled} spellCheck={false} aria-label={field.label}
        onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur() }
        }}
      />
    </span>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[10px] uppercase tracking-wide text-text-4">{label}</span>
      {children}
    </label>
  )
}

/** Style controls of the selected element. Every change goes through the engine's style manager. */
export const DesignInspector = observer(function DesignInspector({ session }: { session: DesignSession }) {
  const { engine } = session
  const selected = engine.elements.selected[0]
  const current = engine.style.selectedStyle?.styles
  if (!selected || !current) return null

  // The style manager merges pending edits at the top level of the style object.
  const pending = current as unknown as Record<string, unknown>
  const read = (key: string): string => {
    const value = pending[key] ?? current.defined[key] ?? current.computed[key]
    return typeof value === 'string' ? value : ''
  }
  const disabled = !session.support?.style

  return (
    <div className="flex flex-col gap-3">
      {SECTIONS.map((section) => {
        const fields = section.fields.filter((field) => !field.when || field.when.values.includes(read(field.when.key)))
        if (fields.length === 0) return null
        return (
          <fieldset key={section.title} className="min-w-0" disabled={disabled}>
            <legend className="mb-1 text-[11px] font-medium text-text-2">{section.title}</legend>
            <div className={`grid gap-x-2 gap-y-1.5 ${GRID_COLUMNS[section.columns]}`}>
              {fields.map((field) => {
                const value = read(field.key)
                return (
                  <Labeled key={field.key} label={field.label}>
                    <StyleInput key={`${selected.domId}:${value}`} field={field} value={value} disabled={disabled} onCommit={(next) => engine.style.update(field.key, next)} />
                  </Labeled>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
})
