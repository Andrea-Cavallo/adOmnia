import { useState, useRef, useEffect } from 'react'
import { X, Plus, Trash2, Upload, FileJson, Check, Eye, EyeOff, ShieldCheck, LockKeyhole } from 'lucide-react'
import type { Environment, EnvVariable } from '@/lib/types'
import { uid, blankEnvVar } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { isVaultRef } from '@/lib/vaultRefs'
import { useModalFocusTrap } from '@/lib/accessibility'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface EnvModalProps {
  environments: Environment[]
  activeEnvId: string | null
  onClose: () => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onSetPrivate: (id: string, value: boolean) => void
  onUpdateVars: (envId: string, variables: EnvVariable[]) => void
}

export function EnvModal({
  environments,
  activeEnvId,
  onClose,
  onAdd,
  onDelete,
  onRename,
  onSetPrivate,
  onUpdateVars,
}: EnvModalProps) {
  const tr = useUiTranslation()
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(activeEnvId)
  const [jsonInput, setJsonInput] = useState('')
  const [importError, setImportError] = useState<UiMessage | ''>('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const newEnvInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useModalFocusTrap(true, onClose, modalRef)

  const selectedEnv = environments.find((e) => e.id === selectedEnvId)

  useEffect(() => {
    if (addingNew) newEnvInputRef.current?.focus()
  }, [addingNew])

  const handleAddVar = () => {
    if (!selectedEnv) return
    onUpdateVars(selectedEnv.id, [...selectedEnv.variables, blankEnvVar()])
  }

  const handleUpdateVar = (varId: string, patch: Partial<EnvVariable>) => {
    if (!selectedEnv) return
    onUpdateVars(
      selectedEnv.id,
      selectedEnv.variables.map((v) => (v.id === varId ? { ...v, ...patch } : v))
    )
  }

  const handleDeleteVar = (varId: string) => {
    if (!selectedEnv) return
    onUpdateVars(selectedEnv.id, selectedEnv.variables.filter((v) => v.id !== varId))
  }

  const handleImportJSON = () => {
    setImportError('')
    try {
      const parsed = JSON.parse(jsonInput)
      if (!selectedEnv) return

      let vars: EnvVariable[] = []
      if (Array.isArray(parsed)) {
        vars = parsed.map((item: { key?: string; value?: string; enabled?: boolean; type?: string }, i: number) => ({
          id: uid(),
          key: item.key ?? `var_${i + 1}`,
          value: item.value ?? '',
          enabled: item.enabled !== false,
          type: (item.type === 'secret' ? 'secret' : 'text') as 'text' | 'secret',
        }))
      } else if (typeof parsed === 'object') {
        vars = Object.entries(parsed).map(([key, value]) => ({
          id: uid(),
          key,
          value: String(value),
          enabled: true,
          type: 'text' as const,
        }))
      }

      if (vars.length === 0) {
        setImportError('No variables found in JSON')
        return
      }

      onUpdateVars(selectedEnv.id, vars)
      setJsonInput('')
    } catch {
      setImportError('Invalid JSON')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string)
        setJsonInput(JSON.stringify(json, null, 2))
      } catch {
        setImportError('Not a valid JSON file')
      }
    }
    reader.readAsText(file)
  }

  const confirmAddEnv = () => {
    if (newEnvName.trim()) onAdd(newEnvName.trim())
    setAddingNew(false)
    setNewEnvName('')
  }

  const cancelAddEnv = () => {
    setAddingNew(false)
    setNewEnvName('')
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={tr('Environments')}
          tabIndex={-1}
          className="w-[720px] h-[480px] bg-surface-1 border border-border-1 rounded-lg shadow-xl flex flex-col animate-in fade-in zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1">
            <span className="text-sm font-semibold text-text-1 flex-1">{tr('Environments')}</span>
            {addingNew ? (
              <div className="flex items-center gap-1">
                <input
                  ref={newEnvInputRef}
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmAddEnv()
                    if (e.key === 'Escape') cancelAddEnv()
                  }}
                  placeholder={tr('Environment name…')}
                  className="h-6 px-2 bg-surface-2 border border-accent rounded text-xs text-text-1 outline-none w-40"
                />
                <button onClick={confirmAddEnv} className="p-1 text-success hover:text-success/80">
                  <Check size={12} />
                </button>
                <button onClick={cancelAddEnv} className="p-1 text-text-4 hover:text-text-1">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingNew(true); setNewEnvName('') }}
                className="px-2 py-1 text-xs text-accent hover:text-accent-light rounded hover:bg-accent/10"
                title={tr('New Environment')}
              >
                <Plus size={14} />
              </button>
            )}
            <button onClick={onClose} className="text-text-4 hover:text-text-1">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 flex min-h-0">
            {/* Left: Environment List */}
            <div className="w-48 border-r border-border-1 flex flex-col">
              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {environments.map((env) => (
                  <div
                    key={env.id}
                    className={cn(
                      'group flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors focus-within:ring-2 focus-within:ring-accent',
                      selectedEnvId === env.id
                        ? 'bg-accent/20 text-accent-light'
                        : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                    )}
                  >
                    {editingName === env.id ? (
                      <input
                        autoFocus
                        className="flex-1 bg-surface-0 border border-accent rounded px-1 text-xs text-text-1 outline-none"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          if (editValue.trim()) onRename(env.id, editValue.trim())
                          setEditingName(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editValue.trim()) {
                            onRename(env.id, editValue.trim())
                            setEditingName(null)
                          }
                          if (e.key === 'Escape') setEditingName(null)
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        aria-pressed={selectedEnvId === env.id}
                        onClick={() => setSelectedEnvId(env.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'F2') return
                          event.preventDefault()
                          setEditingName(env.id)
                          setEditValue(env.name)
                        }}
                        onDoubleClick={() => {
                          setEditingName(env.id)
                          setEditValue(env.name)
                        }}
                        className="min-w-0 flex-1 truncate text-left outline-none"
                      >
                        {env.name}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete({ id: env.id, name: env.name })
                      }}
                      aria-label={tr('Delete')}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-text-4 hover:text-error"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}

                {environments.length === 0 && (
                  <p className="text-xs text-text-4 text-center py-4">{tr('No environments yet.')}</p>
                )}
              </div>
            </div>

            {/* Right: Variable Table & Import */}
            <div className="flex-1 flex flex-col min-w-0">
              {selectedEnv ? (
                <div className="flex-1 flex flex-col p-3 gap-3 overflow-auto">
                  <label className="flex items-center gap-2 px-2 py-2 border border-border-2 rounded bg-surface-2/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEnv.private === true}
                      onChange={(event) => onSetPrivate(selectedEnv.id, event.target.checked)}
                      className="w-3 h-3"
                    />
                    <LockKeyhole size={12} className="text-text-3" />
                    <span className="text-xs text-text-2">{tr('Private environment')}</span>
                    <span className="ml-auto text-[10px] text-text-4">{tr('Local only, excluded from exports')}</span>
                  </label>
                  {/* Import zone */}
                  <div
                    className="flex flex-col gap-2 p-3 border border-dashed border-border-2 rounded"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                  >
                    <div className="flex items-center gap-2">
                      <Upload size={12} className="text-text-4" />
                      <span className="text-[10px] text-text-4">
                        {tr('Drop a JSON file or paste below')}
                      </span>
                    </div>
                    <textarea
                      value={jsonInput}
                      onChange={(e) => { setJsonInput(e.target.value); setImportError('') }}
                      placeholder='[{"key":"BASE_URL","value":"https://api.your-domain.com"}] or {"key":"value"}'
                      rows={3}
                      className="w-full px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-[10px] text-text-1 font-mono placeholder:text-text-4 resize-none focus:border-accent outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleImportJSON}
                        disabled={!jsonInput.trim()}
                        className="flex items-center gap-1 px-2 py-1 bg-accent text-white rounded text-[10px] font-medium disabled:opacity-50"
                      >
                        <FileJson size={10} />
                        {tr('Import JSON')}
                      </button>
                      {importError && <span className="text-[10px] text-error">{tr(importError)}</span>}
                    </div>
                  </div>

                  {/* Variable table */}
                  <div className="flex-1 flex flex-col gap-1 overflow-auto">
                    <div className="grid grid-cols-[20px_1fr_2fr_24px_20px] gap-2 px-2 text-[10px] uppercase tracking-wider text-text-4">
                      <span />
                      <span>{tr('Variable')}</span>
                      <span>{tr('Value')}</span>
                      <span />
                      <span />
                    </div>
                    {selectedEnv.variables.map((v) => {
                      const vaultRef = isVaultRef(v.value)
                      const isSecret = v.type === 'secret' || vaultRef
                      return (
                        <div key={v.id} className="grid grid-cols-[20px_1fr_2fr_24px_20px] gap-2 items-center group">
                          <input
                            type="checkbox"
                            checked={v.enabled}
                            onChange={(e) => handleUpdateVar(v.id, { enabled: e.target.checked })}
                            className="w-3 h-3"
                          />
                          <input
                            value={v.key}
                            onChange={(e) => handleUpdateVar(v.id, { key: e.target.value })}
                            placeholder="VARIABLE"
                            title={v.key ? `{{${v.key}}}` : undefined}
                            className="h-6 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none"
                          />
                          <div className="relative">
                            <input
                              value={v.value}
                              onChange={(e) => handleUpdateVar(v.id, { value: e.target.value })}
                              type={isSecret ? 'password' : 'text'}
                              placeholder={tr('Value or paste a vault: reference')}
                              className={cn(
                                'h-6 px-2 bg-surface-2 border rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none w-full',
                                vaultRef ? 'pl-6 pr-2 border-accent/40' : 'pr-6 border-border-2'
                              )}
                            />
                            {vaultRef && (
                              <ShieldCheck
                                size={11}
                                className="absolute left-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none"
                              />
                            )}
                          </div>
                          <button
                            onClick={() => handleUpdateVar(v.id, { type: isSecret ? 'text' : 'secret' })}
                            className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-text-1"
                            title={isSecret ? tr('Show value') : tr('Mask as secret')}
                          >
                            {isSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                          </button>
                          <button
                            onClick={() => handleDeleteVar(v.id)}
                            className="w-5 h-5 flex items-center justify-center text-text-4 hover:text-error opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      )
                    })}
                    <button
                      onClick={handleAddVar}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:text-accent-light"
                    >
                      <Plus size={11} /> {tr('Add Variable')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs text-text-4">{tr('Select an environment to edit its variables.')}</p>
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
          message={tr('Delete "{{name}}"?', { name: confirmDelete.name })}
          confirmLabel={tr('Delete')}
          variant="danger"
          onConfirm={() => {
            onDelete(confirmDelete.id)
            if (selectedEnvId === confirmDelete.id) setSelectedEnvId(null)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  )
}
