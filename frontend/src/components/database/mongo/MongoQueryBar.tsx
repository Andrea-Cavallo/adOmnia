import { useState } from 'react'
import { ChevronDown, ChevronRight, Filter, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MongoQueryState {
  filter: string
  project: string
  sort: string
  skip: string
  limit: string
}

export const EMPTY_MONGO_QUERY: MongoQueryState = { filter: '', project: '', sort: '', skip: '', limit: '20' }

interface MongoQueryBarProps {
  value: MongoQueryState
  running: boolean
  disabled: boolean
  onChange: (next: MongoQueryState) => void
  onFind: () => void
  onReset: () => void
}

function BarInput({ label, value, placeholder, onChange, onEnter, mono = true, className }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void; onEnter: () => void; mono?: boolean; className?: string
}) {
  return (
    <label className={cn('flex h-8 min-w-0 items-center rounded-md border border-border-2 bg-surface-0 focus-within:border-accent/60', className)}>
      <span className="flex h-full flex-none items-center border-r border-border-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-3">{label}</span>
      <input
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter() }}
        placeholder={placeholder}
        className={cn('h-full min-w-0 flex-1 bg-transparent px-2.5 text-[11.5px] text-text-1 outline-none placeholder:text-text-4', mono && 'font-mono')}
      />
    </label>
  )
}

export function MongoQueryBar({ value, running, disabled, onChange, onFind, onReset }: MongoQueryBarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const set = (patch: Partial<MongoQueryState>) => onChange({ ...value, ...patch })
  const hasOptions = !!(value.project.trim() || value.sort.trim() || value.skip.trim())

  return (
    <div className="flex-none space-y-2 border-b border-border-1 bg-surface-1 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Filter size={13} className="flex-none text-text-4" />
        <BarInput label="Filter" value={value.filter} placeholder="{ field: 'value' }  ·  ObjectId('…'), ISODate('…') supported" onChange={(filter) => set({ filter })} onEnter={onFind} className="flex-1" />
        <button
          type="button"
          onClick={() => setOptionsOpen((v) => !v)}
          aria-expanded={optionsOpen}
          className={cn('flex h-8 flex-none items-center gap-1 rounded-md px-2 text-[11.5px] hover:bg-surface-2', hasOptions ? 'text-accent' : 'text-text-3 hover:text-text-1')}
        >
          {optionsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Options
        </button>
        <button type="button" onClick={onReset} disabled={disabled} title="Reset query" className="flex h-8 flex-none items-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11.5px] text-text-2 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <RotateCcw size={12} /> Reset
        </button>
        <button type="button" onClick={onFind} disabled={disabled || running} className="flex h-8 flex-none items-center gap-1.5 rounded-md bg-accent px-3.5 text-[11.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40">
          <Play size={11} fill="currentColor" /> Find
        </button>
      </div>
      {optionsOpen && (
        <div className="ml-[21px] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_112px_112px] gap-2">
          <BarInput label="Project" value={value.project} placeholder="{ name: 1, _id: 0 }" onChange={(project) => set({ project })} onEnter={onFind} />
          <BarInput label="Sort" value={value.sort} placeholder="{ _id: -1 }" onChange={(sort) => set({ sort })} onEnter={onFind} />
          <BarInput label="Skip" value={value.skip} placeholder="0" onChange={(skip) => set({ skip: skip.replace(/\D/g, '') })} onEnter={onFind} />
          <BarInput label="Limit" value={value.limit} placeholder="20" onChange={(limit) => set({ limit: limit.replace(/\D/g, '') })} onEnter={onFind} />
        </div>
      )}
    </div>
  )
}
