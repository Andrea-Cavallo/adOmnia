import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { KVRow } from '@/lib/types'
import { uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { useEnvironmentsStore } from '@/stores/environments'

interface KVEditorProps {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

const HEADER_PRESETS = [
  ['Accept', 'application/json'],
  ['Accept', 'application/xml'],
  ['Accept', '*/*'],
  ['Content-Type', 'application/json'],
  ['Content-Type', 'application/xml'],
  ['Content-Type', 'application/x-www-form-urlencoded'],
  ['Content-Type', 'multipart/form-data'],
  ['Authorization', 'Bearer {{access_token}}'],
  ['Cache-Control', 'no-cache'],
  ['Idempotency-Key', '{{idempotency_key}}'],
  ['X-Request-ID', '{{request_id}}'],
] as const

export function KVEditor({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: KVEditorProps) {
  const isHeaders = keyPlaceholder.toLowerCase().includes('header')
  const [openId, setOpenId] = useState<string | null>(null)
  const headerNames = Array.from(new Set(HEADER_PRESETS.map(([key]) => key)))
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const resolvedVars = getResolvedVars()
  const hasActiveEnv = activeEnvId !== null
  const update = (id: string, patch: Partial<KVRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const add = (key = '', value = '') => {
    onChange([...rows, { id: uid(), key, value, enabled: true }])
  }

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id)
    onChange(next.length ? next : [{ id: uid(), key: '', value: '', enabled: true }])
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[28px_1fr_1fr_28px] gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className={cn(
            'grid grid-cols-[28px_1fr_1fr_28px] gap-1 px-2 items-center group',
            !r.enabled && 'opacity-40'
          )}
        >
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="w-3.5 h-3.5 accent-accent rounded"
          />
          <div className="relative">
            <input
              className="w-full h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs placeholder:text-text-4 focus:border-accent outline-none"
              placeholder={keyPlaceholder}
              value={r.key}
              onChange={(e) => update(r.id, { key: e.target.value })}
              onFocus={isHeaders ? () => setOpenId(r.id) : undefined}
              onBlur={isHeaders ? () => setTimeout(() => setOpenId((id) => (id === r.id ? null : id)), 120) : undefined}
            />
            {isHeaders && openId === r.id && (() => {
              const matches = headerNames.filter((n) => n.toLowerCase().includes(r.key.toLowerCase()) && n !== r.key)
              if (matches.length === 0) return null
              return (
                <div className="absolute left-0 top-[calc(100%+2px)] z-30 w-full max-h-48 overflow-y-auto rounded-md border border-border-2 bg-surface-1 shadow-lg py-1">
                  {matches.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        update(r.id, { key: name })
                        setOpenId(null)
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-text-2 hover:bg-surface-2 hover:text-text-1"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
          <div className="h-7 bg-surface-2 border border-border-2 rounded focus-within:border-accent overflow-hidden">
            <VarHighlightInput
              value={r.value}
              onChange={(value) => update(r.id, { value })}
              resolvedVars={resolvedVars}
              hasActiveEnv={hasActiveEnv}
              placeholder={valuePlaceholder}
              className="h-full"
            />
          </div>
          <button
            onClick={() => remove(r.id)}
            title="Remove row"
            className="w-6 h-6 flex items-center justify-center text-text-4 hover:text-error rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => add()}
        className="flex items-center gap-1 px-2 py-1 mt-1 text-xs text-text-3 hover:text-text-1 transition-colors"
      >
        <Plus size={12} /> Add row
      </button>
      {isHeaders && (
        <>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            {HEADER_PRESETS.map(([key, value]) => (
              <button
                key={`${key}:${value}`}
                onClick={() => add(key, value)}
                className="rounded border border-border-2 bg-surface-1 px-2 py-0.5 text-[10px] text-text-3 hover:border-accent/50 hover:text-text-1"
                title={`${key}: ${value}`}
              >
                {key === 'Content-Type' || key === 'Accept' ? value : key}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
