import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'

interface Props {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  className?: string
}

/** Compact toolbar picker with a dedicated chevron and the shared keyboard-accessible menu. */
export function CodeStudioToolbarSelect({ label, value, options, onChange, className = '' }: Props) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const selected = options.find((option) => option.value === value)
  const close = () => { setMenu(null); trigger.current?.focus() }
  const open = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 })
  }
  return <>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={!!menu}
      title={`${label}: ${selected?.label ?? value}`}
      onClick={() => menu ? close() : open()}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open() } }}
      className={`inline-flex h-7 min-w-0 shrink-0 items-center gap-2 rounded-[3px] border border-border-1 bg-surface-1 px-2 font-mono text-[11px] text-text-2 hover:border-border-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent ${className}`}>
      <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? value}</span>
      <ChevronDown size={12} aria-hidden="true" className="shrink-0 text-text-3" />
    </button>
    {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y}
      items={options.map((option) => ({ id: option.value, label: option.label, checked: option.value === value }))}
      onSelect={(next) => { close(); onChange(next) }} onClose={close} />}
  </>
}
