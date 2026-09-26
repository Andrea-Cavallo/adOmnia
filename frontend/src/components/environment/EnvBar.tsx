import { useState, useRef, useEffect } from 'react'
import { Plus, Check, X, ChevronDown } from 'lucide-react'
import type { Environment, EnvVariable } from '@/lib/types'
import { EnvModal } from './EnvModal'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'

interface EnvBarProps {
  compact?: boolean
  environments: Environment[]
  activeEnvId: string | null
  onSetActive: (id: string | null) => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdateVars: (envId: string, variables: EnvVariable[]) => void
  onSetPrivate: (envId: string, value: boolean) => void
}

export function EnvBar({
  compact = false,
  environments,
  activeEnvId,
  onSetActive,
  onAdd,
  onDelete,
  onRename,
  onUpdateVars,
  onSetPrivate,
}: EnvBarProps) {
  const tr = useUiTranslation()
  const [showModal, setShowModal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [dropOpen, setDropOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  // The collections context menu opens the environment editor from far away
  // in the tree, so it asks for it through the document rather than by prop.
  useEffect(() => {
    const open = () => setShowModal(true)
    document.addEventListener('adomnia:open-environments', open)
    return () => document.removeEventListener('adomnia:open-environments', open)
  }, [])

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
    ? (environments.find(e => e.id === activeEnvId)?.name ?? tr('Unknown'))
    : tr('No Environment')
  const activeEnv = activeEnvId ? environments.find(e => e.id === activeEnvId) : null
  const activeVarCount = activeEnv?.variables.filter(v => v.enabled && v.key.trim()).length ?? 0

  return (
    <>
      <div className={cn(compact ? 'flex min-w-0 flex-1 items-center' : 'flex h-[var(--ui-toolbar-h)] items-center gap-1.5 border-b border-border-1 px-2.5')}>
        {!compact && <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-4">{tr('Env')}</span>}

        <div ref={dropRef} className={cn('relative flex', compact && 'min-w-0 flex-1')}>
          <button
            onClick={() => compact ? setDropOpen((value) => !value) : setShowModal(true)}
            aria-haspopup="menu"
            aria-expanded={dropOpen}
            className={cn(
              'flex h-6 min-w-0 items-center gap-1.5 px-2 text-[11px] transition-colors outline-none',
              'bg-surface-2 border border-border-2 text-text-1',
              'hover:border-border-3 hover:bg-surface-3',
              compact ? 'h-7 w-full rounded' : 'rounded-l',
              dropOpen && 'border-accent'
            )}
            title={compact ? tr('Switch environment') : tr('Open environment editor')}
          >
            {compact && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-4">{tr('Env')}</span>}
            <span className={cn('truncate', compact ? 'min-w-0 flex-1 text-left' : 'max-w-[160px]')}>{activeLabel}</span>
            {activeEnv && (
              <span className="shrink-0 rounded-sm border border-border-2 bg-surface-1 px-1 text-[9px] text-text-4">
                {activeVarCount}
              </span>
            )}
            {compact && <ChevronDown size={11} className={cn('shrink-0 text-text-4 transition-transform', dropOpen && 'rotate-180')} />}
          </button>
          {!compact && (
            <button
              onClick={() => setDropOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={dropOpen}
              className={cn(
                '-ml-px flex h-6 w-6 items-center justify-center rounded-r border border-border-2 bg-surface-2 text-text-4 transition-colors outline-none',
                'hover:border-border-3 hover:bg-surface-3 hover:text-text-1',
                dropOpen && 'border-accent text-accent'
              )}
              title={tr('Switch environment')}
            >
              <ChevronDown size={11} className={cn('shrink-0 text-text-4 transition-transform', dropOpen && 'rotate-180')} />
            </button>
          )}

          {dropOpen && (
            <div className="absolute top-full left-0 mt-0.5 z-50 min-w-full w-max max-w-56 rounded-md border border-border-2 bg-surface-2 shadow-xl py-0.5 overflow-hidden">
              {(compact || activeEnv) && (
                <button
                  onClick={() => { setShowModal(true); setDropOpen(false) }}
                  className="w-full border-b border-border-1 px-3 py-1.5 text-left text-xs text-accent transition-colors hover:bg-surface-3 hover:text-accent-light"
                >
                  {compact ? tr('Manage environments') : tr('Edit current environment')}
                </button>
              )}
              <button
                onClick={() => { onSetActive(null); setDropOpen(false) }}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs transition-colors',
                  !activeEnvId
                    ? 'bg-surface-3 text-text-1'
                    : 'text-text-3 hover:bg-surface-3 hover:text-text-1'
                )}
              >
                {tr('No Environment')}
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

        {!compact && (adding ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmAdd()
                if (e.key === 'Escape') cancelAdd()
              }}
              placeholder={tr('Env name…')}
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
            title={tr('New environment')}
          >
            <Plus size={12} />
          </button>
        ))}

        {!compact && <button onClick={() => setShowModal(true)} className="ml-auto text-[11px] text-accent hover:text-accent-light" title={tr('Manage environments')}>{tr('Environments')}</button>}
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
          onSetPrivate={onSetPrivate}
        />
      )}
    </>
  )
}
