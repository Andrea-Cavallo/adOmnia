import { useState, useRef, useEffect } from 'react'
import { X, Plus, Trash2, Check } from 'lucide-react'
import type { HostsProfile, HostEntry } from '@/lib/types'
import { blankHostEntry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { useModalFocusTrap } from '@/lib/accessibility'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface HostModalProps {
  profiles: HostsProfile[]
  activeProfileId: string | null
  onClose: () => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdateEntries: (profileId: string, entries: HostEntry[]) => void
}

function isValidIP(value: string): boolean {
  // IPv4
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4.test(value)) {
    return value.split('.').every((n) => parseInt(n, 10) <= 255)
  }
  // IPv6 (basic check)
  const ipv6 = /^[0-9a-fA-F:]+$/
  return ipv6.test(value) && value.includes(':')
}

export function HostModal({
  profiles,
  activeProfileId,
  onClose,
  onAdd,
  onDelete,
  onRename,
  onUpdateEntries,
}: HostModalProps) {
  const tr = useUiTranslation()
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(activeProfileId)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const newProfileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useModalFocusTrap(true, onClose, modalRef)

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)

  useEffect(() => {
    if (addingNew) newProfileInputRef.current?.focus()
  }, [addingNew])

  // Auto-select newly added profile
  useEffect(() => {
    if (profiles.length > 0 && !selectedProfileId) {
      setSelectedProfileId(profiles[profiles.length - 1].id)
    }
  }, [profiles, selectedProfileId])

  const handleAddEntry = () => {
    if (!selectedProfile) return
    onUpdateEntries(selectedProfile.id, [...selectedProfile.entries, blankHostEntry()])
  }

  const handleUpdateEntry = (entryId: string, patch: Partial<HostEntry>) => {
    if (!selectedProfile) return
    onUpdateEntries(
      selectedProfile.id,
      selectedProfile.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e))
    )
  }

  const handleDeleteEntry = (entryId: string) => {
    if (!selectedProfile) return
    onUpdateEntries(selectedProfile.id, selectedProfile.entries.filter((e) => e.id !== entryId))
  }

  const confirmAddProfile = () => {
    if (newProfileName.trim()) {
      onAdd(newProfileName.trim())
    }
    setAddingNew(false)
    setNewProfileName('')
  }

  const cancelAddProfile = () => {
    setAddingNew(false)
    setNewProfileName('')
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={tr('Hosts Profiles')}
          tabIndex={-1}
          className="w-[780px] h-[500px] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col animate-in fade-in zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
            <span className="text-sm font-semibold text-text-1 flex-1">{tr('Hosts Profiles')}</span>
            <span className="text-[10px] text-text-4">
              {tr('Map hostnames to custom IPs — like /etc/hosts, scoped to adOmnia requests')}
            </span>
            {addingNew ? (
              <div className="flex items-center gap-1 ml-2">
                <input
                  ref={newProfileInputRef}
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmAddProfile()
                    if (e.key === 'Escape') cancelAddProfile()
                  }}
                  placeholder={tr('Profile name…')}
                  className="h-6 px-2 bg-surface-2 border border-accent rounded text-xs text-text-1 outline-none w-40"
                />
                <button onClick={confirmAddProfile} className="p-1 text-success hover:text-success/80">
                  <Check size={12} />
                </button>
                <button onClick={cancelAddProfile} className="p-1 text-text-4 hover:text-text-1">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingNew(true); setNewProfileName('') }}
                className="ml-2 px-2 py-1 text-xs text-accent hover:text-accent-light rounded hover:bg-accent/10"
                title={tr('New Profile')}
              >
                <Plus size={14} />
              </button>
            )}
            <button onClick={onClose} className="text-text-4 hover:text-text-1 ml-1">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 flex min-h-0">
            {/* Left: Profile List */}
            <div className="w-48 border-r border-border-1 flex flex-col">
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      'group flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors focus-within:ring-2 focus-within:ring-accent',
                      selectedProfileId === p.id
                        ? 'bg-accent/20 text-accent-light'
                        : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                    )}
                  >
                    {editingName === p.id ? (
                      <input
                        autoFocus
                        className="flex-1 bg-surface-0 border border-accent rounded px-1 text-xs text-text-1 outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          if (editValue.trim()) onRename(p.id, editValue.trim())
                          setEditingName(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editValue.trim()) {
                            onRename(p.id, editValue.trim())
                            setEditingName(null)
                          }
                          if (e.key === 'Escape') setEditingName(null)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-pressed={selectedProfileId === p.id}
                        className="min-w-0 flex-1 truncate text-left outline-none"
                        onClick={() => setSelectedProfileId(p.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'F2') return
                          event.preventDefault()
                          setEditingName(p.id)
                          setEditValue(p.name)
                        }}
                        onDoubleClick={() => {
                          setEditingName(p.id)
                          setEditValue(p.name)
                        }}
                      >
                        {p.name}
                      </button>
                    )}
                    <span className="text-[9px] text-text-4 opacity-0 group-hover:opacity-100 shrink-0">
                      {p.entries.filter((e) => e.enabled).length}/{p.entries.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete({ id: p.id, name: p.name })
                      }}
                      aria-label={tr('Delete')}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-text-4 hover:text-error shrink-0"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}

                {profiles.length === 0 && (
                  <p className="text-xs text-text-4 text-center py-4">{tr('No profiles yet.')}</p>
                )}
              </div>
            </div>

            {/* Right: Entries Table */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedProfile ? (
                <div className="flex-1 flex flex-col p-3 gap-2 overflow-auto">
                  {/* Table header */}
                  <div className="grid grid-cols-[20px_1fr_16px_120px_1fr_20px] gap-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
                    <span />
                    <span>{tr('Host')}</span>
                    <span />
                    <span>{tr('IP Address')}</span>
                    <span>{tr('Note')}</span>
                    <span />
                  </div>

                  {/* Entries */}
                  <div className="flex-1 flex flex-col gap-1 overflow-auto">
                    {selectedProfile.entries.map((entry) => {
                      const ipInvalid = entry.ip !== '' && !isValidIP(entry.ip)
                      return (
                        <div
                          key={entry.id}
                          className="grid grid-cols-[20px_1fr_16px_120px_1fr_20px] gap-2 items-center group"
                        >
                          {/* Enable toggle */}
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            onChange={(e) => handleUpdateEntry(entry.id, { enabled: e.target.checked })}
                            className="w-3 h-3"
                          />
                          {/* Host */}
                          <input
                            value={entry.host}
                            onChange={(e) => handleUpdateEntry(entry.id, { host: e.target.value })}
                            placeholder="api.example.com"
                            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none"
                          />
                          {/* Arrow */}
                          <span className="text-text-4 text-xs text-center">→</span>
                          {/* IP */}
                          <input
                            value={entry.ip}
                            onChange={(e) => handleUpdateEntry(entry.id, { ip: e.target.value })}
                            placeholder="192.168.1.50"
                            title={ipInvalid ? tr('Invalid IP address') : undefined}
                            className={cn(
                              'h-6 px-2 bg-surface-2 border rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none',
                              ipInvalid ? 'border-error' : 'border-border-2'
                            )}
                          />
                          {/* Note */}
                          <input
                            value={entry.note}
                            onChange={(e) => handleUpdateEntry(entry.id, { note: e.target.value })}
                            placeholder={tr('optional label')}
                            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-3 placeholder:text-text-4 focus:border-accent outline-none"
                          />
                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-error opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      )
                    })}

                    <button
                      onClick={handleAddEntry}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:text-accent-light mt-1"
                    >
                      <Plus size={11} /> {tr('Add Entry')}
                    </button>
                  </div>

                  {/* Footer hint */}
                  <p className="text-[10px] text-text-4 pt-1 border-t border-border-1">
                    {tr('Tip: use')} <span className="font-mono">host:port</span> {tr('for port-specific overrides (e.g.')} <span className="font-mono">api.example.com:443</span>).
                    {' '}{tr('Host header and TLS SNI are preserved — HTTPS works correctly.')}
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-text-4">{tr('Select a profile to edit its entries.')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          open
          title={tr('Delete')}
          message={tr('Delete profile "{{name}}"?', { name: confirmDelete.name })}
          confirmLabel={tr('Delete')}
          variant="danger"
          onConfirm={() => {
            onDelete(confirmDelete.id)
            if (selectedProfileId === confirmDelete.id) setSelectedProfileId(null)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
