import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Plus, Trash2, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore, type GoIDEState } from '@/stores/goide'
import { GoIDERunConfigurationKind } from '@/lib/goide-api'
import type { GoIDERunConfiguration } from '@/lib/goide-api'
import { GoStudioEntryList } from './GoStudioEntryList'
import { GoStudioRunParameters } from './GoStudioRunParameters'

/** Riferimento stabile: un array nuovo nel selettore Zustand fa ridisegnare all'infinito. */
const EMPTY_CONFIGS: GoIDEState['runConfigsBySession'][string] = []

interface GoStudioRunConfigurationsProps {
  open: boolean
  sessionId: string
  /** Bozza precompilata (es. "Save as configuration" dal ▶ di un Makefile o Dockerfile). */
  initialDraft?: GoIDERunConfiguration | null
  onClose: () => void
}

const KINDS: Array<{ value: GoIDERunConfiguration['kind']; label: string; hint: string; available: boolean }> = [
  { value: GoIDERunConfigurationKind.RunKindPackage, label: 'Package', hint: 'go run on a package path', available: true },
  { value: GoIDERunConfigurationKind.RunKindBuild, label: 'Build', hint: 'go build on a package path', available: true },
  { value: GoIDERunConfigurationKind.RunKindFiles, label: 'File list', hint: 'go run on explicit Go files', available: true },
  { value: GoIDERunConfigurationKind.RunKindTest, label: 'Test', hint: 'go test on a package path', available: true },
  { value: GoIDERunConfigurationKind.RunKindBinary, label: 'Compiled binary', hint: 'runs a binary built inside the project', available: true },
  { value: GoIDERunConfigurationKind.RunKindMake, label: 'Make target', hint: 'make -f <Makefile> <targets>; options such as -j4 go in MAKEFLAGS', available: true },
  { value: GoIDERunConfigurationKind.RunKindDockerBuild, label: 'Docker build', hint: 'docker build of a Dockerfile, with stage, tag and build args', available: true },
  { value: GoIDERunConfigurationKind.RunKindDockerCompose, label: 'Docker Compose', hint: 'docker compose -f <file> up [services] or down; Stop runs docker compose stop', available: true },
  { value: GoIDERunConfigurationKind.RunKindDockerRun, label: 'Docker build & run', hint: 'docker build, then docker run --rm of the image; Stop really stops the container', available: true },
]

const TOOL_KINDS = new Set<string>([GoIDERunConfigurationKind.RunKindMake, GoIDERunConfigurationKind.RunKindDockerBuild, GoIDERunConfigurationKind.RunKindDockerRun, GoIDERunConfigurationKind.RunKindDockerCompose])
const isDockerKind = (kind: string) => kind === GoIDERunConfigurationKind.RunKindDockerBuild || kind === GoIDERunConfigurationKind.RunKindDockerRun

function emptyConfiguration(sessionId: string): GoIDERunConfiguration {
  return {
    id: '', sessionId, name: 'New configuration', kind: GoIDERunConfigurationKind.RunKindPackage, target: '.',
    files: [], binaryPath: '', workingDirectory: '', goArguments: [], programArguments: [],
    buildTags: [], environment: [], docker: {}, order: 0, createdAt: '', updatedAt: '',
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
export function GoStudioRunConfigurations({ open, sessionId, initialDraft, onClose }: GoStudioRunConfigurationsProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const configs = useGoIDEStore((state) => state.runConfigsBySession[sessionId] ?? EMPTY_CONFIGS)
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
    if (!open || !initialDraft) return
    setSelectedId(null)
    setDraft(initialDraft)
  }, [initialDraft, open])

  useEffect(() => {
    if (!open || (initialDraft && !selectedId)) return
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

  const docker = draft.docker ?? {}
  const patchDocker = (change: Partial<NonNullable<GoIDERunConfiguration['docker']>>) => patch({ docker: { ...docker, ...change } })
  const isTool = TOOL_KINDS.has(draft.kind)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
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
                  onChange={(event) => {
                    const kind = event.target.value as GoIDERunConfiguration['kind']
                    const fileDefault = kind === GoIDERunConfigurationKind.RunKindMake ? 'Makefile' : kind === GoIDERunConfigurationKind.RunKindDockerCompose ? 'docker-compose.yml' : isDockerKind(kind) ? 'Dockerfile' : '.'
                    patch({ kind, target: TOOL_KINDS.has(kind) !== isTool || !draft.target ? fileDefault : draft.target })
                  }}
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
              ) : draft.kind === GoIDERunConfigurationKind.RunKindBinary ? (
                textField('Binary path', draft.binaryPath ?? '', (next) => patch({ binaryPath: next }), 'bin/app')
              ) : draft.kind === GoIDERunConfigurationKind.RunKindDockerCompose ? (
                textField('Compose file', draft.target, (next) => patch({ target: next }), 'docker-compose.yml')
              ) : draft.kind === GoIDERunConfigurationKind.RunKindMake ? (
                textField('Makefile', draft.target, (next) => patch({ target: next }), 'Makefile')
              ) : isDockerKind(draft.kind) ? (
                textField('Dockerfile', draft.target, (next) => patch({ target: next }), 'Dockerfile')
              ) : (
                textField('Target package', draft.target, (next) => patch({ target: next }), '.')
              )}

              {textField('Working directory', draft.workingDirectory, (next) => patch({ workingDirectory: next }), 'Project root')}
              {!isTool && textField('Go tool flags', (draft.goArguments ?? []).join(' '), (next) => patch({ goArguments: splitList(next, /\s+/) }), '-v -trimpath')}
              {draft.kind === GoIDERunConfigurationKind.RunKindDockerCompose
                ? textField('Command and services', (draft.programArguments ?? []).join(' '), (next) => patch({ programArguments: splitList(next, /\s+/) }), 'up api db  ·  down')
                : draft.kind === GoIDERunConfigurationKind.RunKindMake
                ? textField('Targets and variables', (draft.programArguments ?? []).join(' '), (next) => patch({ programArguments: splitList(next, /\s+/) }), 'build test VERSION=1.2.3')
                : draft.kind !== GoIDERunConfigurationKind.RunKindDockerBuild && textField(draft.kind === GoIDERunConfigurationKind.RunKindDockerRun ? 'Container command' : 'Program arguments', (draft.programArguments ?? []).join(' '), (next) => patch({ programArguments: splitList(next, /\s+/) }), draft.kind === GoIDERunConfigurationKind.RunKindDockerRun ? 'Image default' : '--port 8080')}
              {!isTool && textField('Build tags', (draft.buildTags ?? []).join(','), (next) => patch({ buildTags: splitList(next, /,/) }), 'integration,sqlite')}
              {isDockerKind(draft.kind) && (
                <>
                  {textField('Build context', docker.context ?? '', (next) => patchDocker({ context: next }), '. (Dockerfile folder)')}
                  {textField('Image tag', docker.tag ?? '', (next) => patchDocker({ tag: next }), '<project>:dev')}
                  {textField('Stage (--target)', docker.stage ?? '', (next) => patchDocker({ stage: next }), 'Last stage')}
                  <label className="flex items-end gap-2 pb-2 text-[10px] font-medium text-text-3">
                    <input type="checkbox" checked={!!docker.noCache} onChange={(event) => patchDocker({ noCache: event.target.checked })} className="accent-accent" />
                    Build without cache (--no-cache)
                  </label>
                </>
              )}
              {draft.kind === GoIDERunConfigurationKind.RunKindDockerRun && (
                <>
                  {textField('Published ports', (docker.ports ?? []).join(' '), (next) => patchDocker({ ports: splitList(next, /[\s,]+/) }), '8080:8080 9090')}
                  {textField('Volumes', (docker.volumes ?? []).join(' '), (next) => patchDocker({ volumes: splitList(next, /\s+/) }), 'data:/data:ro')}
                </>
              )}
            </div>

            {isDockerKind(draft.kind) && (
              <GoStudioEntryList label="Build args" empty="No build arg." entries={docker.buildArgs ?? []} onChange={(buildArgs) => patchDocker({ buildArgs })} />
            )}

            {draft.kind !== GoIDERunConfigurationKind.RunKindDockerBuild && (
              <GoStudioEntryList
                label={draft.kind === GoIDERunConfigurationKind.RunKindDockerRun ? 'Container environment' : 'Environment'}
                empty="No environment override."
                entries={draft.environment ?? []}
                onChange={(environment) => patch({ environment })}
              />
            )}

            <GoStudioRunParameters draft={draft} configs={configs} patch={patch} />

            <p className="mt-3 text-[9px] leading-4 text-text-4">
              {kindInfo.hint}. {isTool ? 'Arguments are passed as a list, never through a shell.' : 'Tool flags and program arguments stay separate and reach Go without shell concatenation.'}
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
