import { useState, useRef, useEffect } from 'react'
import { Plus, Check, X, ChevronDown } from 'lucide-react'
import type { HostsProfile, HostEntry } from '@/lib/types'
import { HostModal } from './HostModal'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'

interface HostBarProps {
  compact?: boolean
  profiles: HostsProfile[]
  activeProfileId: string | null
  onSetActive: (id: string | null) => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdateEntries: (profileId: string, entries: HostEntry[]) => void
}

export function HostBar({
  compact = false,
  profiles,
  activeProfileId,
  onSetActive,
  onAdd,
  onDelete,
  onRename,
  onUpdateEntries,
}: HostBarProps) {
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

  const activeLabel = activeProfileId
    ? (profiles.find(p => p.id === activeProfileId)?.name ?? tr('Unknown'))
    : tr('No Hosts')

  return (
    <>
      <div className={cn(compact ? 'flex min-w-0 flex-1 items-center' : 'flex h-[var(--ui-toolbar-h)] items-center gap-1.5 border-b border-border-1 px-2.5')}>
        {!compact && <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-4">{tr('Hosts')}</span>}

        {/* Custom dropdown */}
        <div ref={dropRef} className={cn('relative', compact && 'min-w-0 flex-1')}>
          <button
            onClick={() => setDropOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={dropOpen}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded px-2 text-[11px] transition-colors outline-none',
              'bg-surface-2 border border-border-2 text-text-1',
              'hover:border-border-3 hover:bg-surface-3',
              compact && 'h-7 w-full min-w-0',
              dropOpen && 'border-accent'
            )}
          >
            {compact && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-text-4">{tr('Hosts')}</span>}
            <span className={cn('truncate', compact ? 'min-w-0 flex-1 text-left' : 'max-w-[160px]')}>{activeLabel}</span>
            <ChevronDown
              size={11}
              className={cn('shrink-0 text-text-4 transition-transform', dropOpen && 'rotate-180')}
            />
          </button>

          {dropOpen && (
            <div className="absolute top-full left-0 mt-0.5 z-50 min-w-full w-max max-w-52 rounded-md border border-border-2 bg-surface-2 shadow-xl py-0.5 overflow-hidden">
              {compact && (
                <button
                  onClick={() => { setShowModal(true); setDropOpen(false) }}
                  className="w-full border-b border-border-1 px-3 py-1.5 text-left text-xs text-accent transition-colors hover:bg-surface-3 hover:text-accent-light"
                >
                  {tr('Manage hosts profiles')}
                </button>
              )}
              <button
                onClick={() => { onSetActive(null); setDropOpen(false) }}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs transition-colors',
                  !activeProfileId
                    ? 'bg-surface-3 text-text-1'
                    : 'text-text-3 hover:bg-surface-3 hover:text-text-1'
                )}
              >
                {tr('No Hosts')}
              </button>
              {profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSetActive(p.id); setDropOpen(false) }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs transition-colors',
                    activeProfileId === p.id
                      ? 'bg-surface-3 text-text-1'
                      : 'text-text-2 hover:bg-surface-3 hover:text-text-1'
                  )}
                >
                  {p.name}
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
              placeholder={tr('Profile name…')}
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
            title={tr('New hosts profile')}
          >
            <Plus size={12} />
          </button>
        ))}

        {!compact && <button onClick={() => setShowModal(true)} className="ml-auto text-[11px] text-accent hover:text-accent-light" title={tr('Manage hosts profiles')}>{tr('Hosts')}</button>}
      </div>

      {showModal && (
        <HostModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          onClose={() => setShowModal(false)}
          onAdd={onAdd}
          onDelete={onDelete}
          onRename={onRename}
          onUpdateEntries={onUpdateEntries}
        />
      )}
    </>
  )
}
