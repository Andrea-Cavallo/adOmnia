import { useState, useRef, useEffect } from 'react'
import { Plus, Check, X } from 'lucide-react'
import type { Environment, EnvVariable } from '@/lib/types'
import { EnvModal } from './EnvModal'

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const handleAdd = () => {
    setNewName('')
    setAdding(true)
  }

  const confirmAdd = () => {
    if (newName.trim()) onAdd(newName.trim())
    setAdding(false)
    setNewName('')
  }

  const cancelAdd = () => {
    setAdding(false)
    setNewName('')
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-1">
        <span className="text-[10px] text-text-4 uppercase tracking-wider">Env</span>
        <select
          value={activeEnvId ?? ''}
          onChange={(e) => onSetActive(e.target.value || null)}
          className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 focus:border-accent outline-none"
        >
          <option value="">No Environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>

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
