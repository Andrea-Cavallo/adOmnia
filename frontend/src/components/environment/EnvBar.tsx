import { useState, useRef, useEffect } from 'react'
import { Plus, Check, X, ChevronDown } from 'lucide-react'
import type { Environment, EnvVariable } from '@/lib/types'
import { EnvModal } from './EnvModal'
import { cn } from '@/lib/utils'

interface EnvBarProps {
  environments: Environment[]
  activeEnvId: string | null
  onSetActive: (id: string | null) => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdateVars: (envId: string, variables: EnvVariable[]) => void
}

export function EnvBar({
  environments,
  activeEnvId,
  onSetActive,
  onAdd,
  onDelete,
  onRename,
  onUpdateVars,
}: EnvBarProps) {
  const [showModal, setShowModal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!dropOpen) return
    const handler = (e: MouseEvent) => {
      if (!dropRef.current?.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropOpen])

  const handleAdd = () => { setNewName(''); setAdding(true) }
  const confirmAdd = () => {
    if (newName.trim()) onAdd(newName.trim())
    setAdding(false)
    setNewName('')
  }
  const cancelAdd = () => { setAdding(false); setNewName('') }

  const activeLabel = activeEnvId
    ? (environments.find(e => e.id === activeEnvId)?.name ?? 'Unknown')
    : 'No Environment'

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-1">
        <span className="text-[10px] text-text-4 uppercase tracking-wider shrink-0">Env</span>

        {/* Custom dropdown */}
        <div ref={dropRef} className="relative">
          <button
            onClick={() => setDropOpen(v => !v)}
            className={cn(
              'flex items-center gap-1.5 h-6 px-2 rounded text-xs transition-colors outline-none',
              'bg-surface-2 border border-border-2 text-text-1',
              'hover:border-border-3 hover:bg-surface-3',
              dropOpen && 'border-accent'
            )}
          >
            <span className="max-w-[160px] truncate">{activeLabel}</span>
            <ChevronDown
              size={11}
              className={cn('shrink-0 text-text-4 transition-transform', dropOpen && 'rotate-180')}
            />
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 mt-0.5 z-50 min-w-full w-max max-w-52 rounded-md border border-border-2 bg-surface-2 shadow-xl py-0.5 overflow-hidden">
              <button
                onClick={() => { onSetActive(null); setDropOpen(false) }}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs transition-colors',
                  !activeEnvId
                    ? 'bg-surface-3 text-text-1'
                    : 'text-text-3 hover:bg-surface-3 hover:text-text-1'
                )}
              >
                No Environment
              </button>
              {environments.map(env => (
                <button
                  key={env.id}
                  onClick={() => { onSetActive(env.id); setDropOpen(false) }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs transition-colors',
                    activeEnvId === env.id
                      ? 'bg-surface-3 text-text-1'
                      : 'text-text-2 hover:bg-surface-3 hover:text-text-1'
                  )}
                >
                  {env.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {adding ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmAdd()
                if (e.key === 'Escape') cancelAdd()
              }}
              placeholder="Env name…"
              className="h-6 px-2 bg-surface-2 border border-accent rounded text-xs text-text-1 outline-none w-32"
            />
            <button onClick={confirmAdd} className="w-5 h-5 flex items-center justify-center text-success hover:text-success/80">
              <Check size={11} />
            </button>
            <button onClick={cancelAdd} className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-text-1">
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleAdd}
            className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-text-1 rounded"
            title="New environment"
          >
            <Plus size={12} />
          </button>
        )}

        <button
          onClick={() => setShowModal(true)}
          className="text-xs text-accent hover:text-accent-light ml-auto"
          title="Manage environments"
        >
          Environments
        </button>
      </div>

      {showModal && (
        <EnvModal
          environments={environments}
          activeEnvId={activeEnvId}
          onClose={() => setShowModal(false)}
          onAdd={onAdd}
          onDelete={onDelete}
          onRename={onRename}
          onUpdateVars={onUpdateVars}
        />
      )}
    </>
  )
}
