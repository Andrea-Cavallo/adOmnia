import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'
import { GoIDERunConfigurationKind } from '@/lib/goide-api'
import type { GoIDEEnvironmentEntry, GoIDERunConfiguration } from '@/lib/goide-api'

interface GoStudioRunConfigurationsProps {
  open: boolean
  sessionId: string
  onClose: () => void
}

const KINDS: Array<{ value: GoIDERunConfiguration['kind']; label: string; hint: string; available: boolean }> = [
  { value: GoIDERunConfigurationKind.RunKindPackage, label: 'Package', hint: 'go run on a package path', available: true },
  { value: GoIDERunConfigurationKind.RunKindBuild, label: 'Build', hint: 'go build on a package path', available: true },
  { value: GoIDERunConfigurationKind.RunKindFiles, label: 'File list', hint: 'go run on explicit Go files', available: true },
  { value: GoIDERunConfigurationKind.RunKindTest, label: 'Test', hint: 'available with the test runner in Phase 4', available: false },
]

function emptyConfiguration(sessionId: string): GoIDERunConfiguration {
  return {
    id: '', sessionId, name: 'New configuration', kind: GoIDERunConfigurationKind.RunKindPackage, target: '.',
    files: [], binaryPath: '', workingDirectory: '', goArguments: [], programArguments: [],
    buildTags: [], environment: [], order: 0, createdAt: '', updatedAt: '',
  } as GoIDERunConfiguration
}

function splitList(value: string, separator: RegExp): string[] {
  return value.split(separator).map((item) => item.trim()).filter(Boolean)
}

/**
 * Gestore delle configurazioni Run persistenti: elenco a sinistra, editor a
 * destra. I valori marcati come segreti non vengono salvati: resta la chiave e
 * il valore viene richiesto all'avvio.
 */
export function GoStudioRunConfigurations({ open, sessionId, onClose }: GoStudioRunConfigurationsProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const configs = useGoIDEStore((state) => state.runConfigsBySession[sessionId] ?? [])
  const loadRunConfigurations = useGoIDEStore((state) => state.loadRunConfigurations)
  const saveRunConfiguration = useGoIDEStore((state) => state.saveRunConfiguration)
  const duplicateRunConfiguration = useGoIDEStore((state) => state.duplicateRunConfiguration)
  const reorderRunConfigurations = useGoIDEStore((state) => state.reorderRunConfigurations)
  const deleteRunConfiguration = useGoIDEStore((state) => state.deleteRunConfiguration)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<GoIDERunConfiguration>(() => emptyConfiguration(sessionId))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) void loadRunConfigurations(sessionId)
  }, [loadRunConfigurations, open, sessionId])

  useEffect(() => {
    if (!open) return
    const current = configs.find((config) => config.id === selectedId) ?? configs[0] ?? null
    setSelectedId(current?.id ?? null)
    setDraft(current ? { ...current } : emptyConfiguration(sessionId))
    // Ricaricare l'elenco non deve sovrascrivere le modifiche in corso su un
    // nuovo elemento non ancora salvato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.length, open, selectedId, sessionId])

  const kindInfo = useMemo(() => KINDS.find((kind) => kind.value === draft.kind) ?? KINDS[0], [draft.kind])

  if (!open) return null

  const patch = (change: Partial<GoIDERunConfiguration>) => setDraft((current) => ({ ...current, ...change }))

  const setEnvironment = (index: number, change: Partial<GoIDEEnvironmentEntry>) => {
    setDraft((current) => ({
      ...current,
      environment: (current.environment ?? []).map((entry, position) => position === index ? { ...entry, ...change } : entry),
    }))
  }

  const save = async () => {
    setSaving(true)
    const saved = await saveRunConfiguration(draft)
    setSaving(false)
    if (saved) setSelectedId(saved.id)
  }

  const remove = async (configId: string) => {
    const target = configs.find((config) => config.id === configId)
    const approved = await confirm({
      title: `Delete "${target?.name ?? 'configuration'}"?`,
      message: 'The configuration is removed from this project. Files and code are untouched.',
      confirmLabel: 'Delete', variant: 'danger',
    })
    if (!approved) return
    await deleteRunConfiguration(configId)
    setSelectedId(null)
  }

  const move = async (configId: string, delta: number) => {
    const order = configs.map((config) => config.id)
    const index = order.indexOf(configId)
    const next = index + delta
    if (index < 0 || next < 0 || next >= order.length) return
    order.splice(next, 0, ...order.splice(index, 1))
    await reorderRunConfigurations(order)
  }

  const textField = (label: string, value: string, onChange: (next: string) => void, placeholder: string) => (
    <label className="block text-[10px] font-medium text-text-3">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Run configurations"
        tabIndex={-1}
        className="flex h-[560px] w-[780px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">Run configurations</h2>
          <button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3">
            <X size={12} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-56 shrink-0 flex-col border-r border-border-1">
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {configs.length === 0 && <p className="px-3 py-2 text-[10px] text-text-4">No configuration yet.</p>}
              {configs.map((config) => (
                <div
                  key={config.id}
                  className={`group flex h-8 items-center gap-1 px-2 text-[11px] ${
                    config.id === selectedId ? 'bg-surface-3 text-text-1' : 'text-text-2 hover:bg-surface-2'
                  }`}
                >
                  <button type="button" onClick={() => setSelectedId(config.id)} className="min-w-0 flex-1 truncate text-left">
                    {config.name}
                    <span className="ml-1 text-[9px] text-text-4">{config.kind}</span>
                  </button>
                  <button type="button" onClick={() => void move(config.id, -1)} title="Move up" className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-text-1 group-hover:opacity-100"><ChevronUp size={11} /></button>
                  <button type="button" onClick={() => void move(config.id, 1)} title="Move down" className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-text-1 group-hover:opacity-100"><ChevronDown size={11} /></button>
                  <button type="button" onClick={() => void duplicateRunConfiguration(config.id)} title="Duplicate" className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-text-1 group-hover:opacity-100"><Copy size={11} /></button>
                  <button type="button" onClick={() => void remove(config.id)} title="Delete" className="grid h-5 w-5 place-items-center rounded text-text-4 opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setSelectedId(null); setDraft(emptyConfiguration(sessionId)) }}
              className="flex h-8 shrink-0 items-center gap-1.5 border-t border-border-1 px-3 text-[10px] text-text-3 hover:bg-surface-2 hover:text-text-1"
            >
              <Plus size={11} /> New configuration
            </button>
          </aside>

          <div className="min-w-0 flex-1 overflow-auto p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[10px] font-medium text-text-3">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
                />
              </label>
              <label className="block text-[10px] font-medium text-text-3">
                Kind
                <select
                  value={draft.kind}
                  onChange={(event) => patch({ kind: event.target.value as GoIDERunConfiguration['kind'] })}
                  className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent"
                >
                  {KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value} disabled={!kind.available}>
                      {kind.label}{kind.available ? '' : ' — not available yet'}
                    </option>
                  ))}
                </select>
              </label>

              {draft.kind === GoIDERunConfigurationKind.RunKindFiles ? (
                <label className="col-span-2 block text-[10px] font-medium text-text-3">
                  Go files (one per line)
                  <textarea
                    value={(draft.files ?? []).join('\n')}
                    onChange={(event) => patch({ files: splitList(event.target.value, /\r?\n/) })}
                    placeholder={'main.go\nhelper.go'}
                    className="mt-1 h-16 w-full resize-none rounded border border-border-1 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                  />
                </label>
              ) : (
                textField('Target package', draft.target, (next) => patch({ target: next }), '.')
              )}

              {textField('Working directory', draft.workingDirectory, (next) => patch({ workingDirectory: next }), 'Project root')}
              {textField('Go tool flags', (draft.goArguments ?? []).join(' '), (next) => patch({ goArguments: splitList(next, /\s+/) }), '-race -v')}
              {textField('Program arguments', (draft.programArguments ?? []).join(' '), (next) => patch({ programArguments: splitList(next, /\s+/) }), '--port 8080')}
              {textField('Build tags', (draft.buildTags ?? []).join(','), (next) => patch({ buildTags: splitList(next, /,/) }), 'integration,sqlite')}
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-medium text-text-3">Environment</span>
                <button
                  type="button"
                  onClick={() => patch({ environment: [...(draft.environment ?? []), { key: '', value: '', secret: false }] })}
                  className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1"
                  title="Add variable"
                >
                  <Plus size={11} />
                </button>
              </div>
              {(draft.environment ?? []).length === 0 && <p className="text-[10px] text-text-4">No environment override.</p>}
              {(draft.environment ?? []).map((entry, index) => (
                <div key={index} className="mb-1 flex items-center gap-1.5">
                  <input
                    value={entry.key}
                    onChange={(event) => setEnvironment(index, { key: event.target.value })}
                    placeholder="NAME"
                    className="h-7 w-40 rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent"
                  />
                  <input
                    value={entry.secret ? '' : entry.value ?? ''}
                    onChange={(event) => setEnvironment(index, { value: event.target.value })}
                    disabled={entry.secret}
                    placeholder={entry.secret ? 'asked when you launch' : 'value'}
                    className="h-7 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setEnvironment(index, { secret: !entry.secret, value: '' })}
                    title={entry.secret ? 'Stored as a secret: value is asked at launch' : 'Mark as secret'}
                    className={`grid h-7 w-7 place-items-center rounded border ${
                      entry.secret ? 'border-accent text-accent' : 'border-border-1 text-text-4 hover:text-text-1'
                    }`}
                  >
                    <KeyRound size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ environment: (draft.environment ?? []).filter((_, position) => position !== index) })}
                    title="Remove variable"
                    className="grid h-7 w-7 place-items-center rounded text-text-4 hover:text-danger"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[9px] leading-4 text-text-4">
              {kindInfo.hint}. Tool flags and program arguments stay separate and reach Go without shell concatenation.
              Secret values are never written to disk: only the variable name is stored and the value is requested at launch.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Close</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !draft.name.trim()}
            className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            {selectedId ? 'Save configuration' : 'Create configuration'}
          </button>
        </div>
      </div>
    </div>
  )
}
