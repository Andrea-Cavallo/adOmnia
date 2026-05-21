import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

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
  return (
    <label className="flex items-center justify-between py-2 px-1 cursor-pointer group">
      <div>
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-accent rounded"
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
  return (
    <label className="flex items-center justify-between py-2 px-1">
      <div>
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none max-w-[160px]"
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
  return (
    <label className="flex items-center justify-between py-2 px-1">
      <div>
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))
        }
        className="w-24 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
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
  return (
    <label className="flex items-center justify-between py-2 px-1">
      <div className="flex-1 mr-3">
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-48 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
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
  return (
    <label className="flex items-center justify-between py-2 px-1">
      <div className="flex-1 mr-3">
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-48 h-7 pl-2 pr-7 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-text-4 hover:text-text-2"
          tabIndex={-1}
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
  return (
    <label className="flex flex-col gap-1 py-2 px-1">
      <div>
        <div className="text-xs text-text-1">{label}</div>
        <div className="text-[10px] text-text-4">{desc}</div>
      </div>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none resize-y"
      />
    </label>
  )
}
