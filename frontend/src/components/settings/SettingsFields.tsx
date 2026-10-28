import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

const fieldRowClass = 'settings-field grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(220px,320px)] items-center gap-x-8 gap-y-2 px-0 py-4 max-lg:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] max-md:grid-cols-1'
const fieldCopyClass = 'min-w-0'
const fieldLabelClass = 'text-[14px] font-medium text-text-1'
const fieldDescriptionClass = 'mt-0.5 text-[12px] leading-relaxed text-text-3'
const fieldControlClass = 'h-9 w-full min-w-0 rounded border border-border-2 bg-surface-2 px-3 text-[13px] text-text-1 outline-none focus:border-accent'

export function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={`${fieldRowClass} cursor-pointer group`}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 justify-self-end rounded accent-accent max-md:justify-self-start"
      />
    </label>
  )
}

export function Select({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string
  desc: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <label className={fieldRowClass}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <select
        aria-label={label}
        value={value}
        title={selectedLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldControlClass} !pr-9`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function NumberInput({
  label,
  desc,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  desc: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={fieldRowClass}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <input
        id={id}
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))
        }
        className={`${fieldControlClass} w-32 justify-self-end max-md:justify-self-start`}
      />
    </label>
  )
}

export function TextInput({
  label,
  desc,
  value,
  placeholder,
  onChange,
}: {
  label: string
  desc: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={fieldRowClass}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <input
        id={id}
        type="text"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={fieldControlClass}
      />
    </label>
  )
}

export function PasswordInput({
  label,
  desc,
  value,
  placeholder,
  onChange,
}: {
  label: string
  desc: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    <label htmlFor={id} className={fieldRowClass}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <div className="relative min-w-0">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldControlClass} pr-9`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-2"
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={show}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
    </label>
  )
}

export function TextAreaInput({
  label,
  desc,
  value,
  placeholder,
  rows = 3,
  onChange,
}: {
  label: string
  desc: string
  value: string
  placeholder?: string
  rows?: number
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={`${fieldRowClass} items-start`}>
      <div className={fieldCopyClass}>
        <div className={fieldLabelClass}>{label}</div>
        <div className={fieldDescriptionClass}>{desc}</div>
      </div>
      <textarea
        id={id}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-20 w-full min-w-0 resize-y rounded border border-border-2 bg-surface-2 px-3 py-2 text-xs text-text-1 outline-none focus:border-accent"
      />
    </label>
  )
}
