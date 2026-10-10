import { ArrowRight, Plus, X } from 'lucide-react'
import { GoIDERunConfigurationKind, type GoIDERunConfiguration } from '@/lib/goide-api'

interface Props {
  draft: GoIDERunConfiguration
  configs: GoIDERunConfiguration[]
  patch: (change: Partial<GoIDERunConfiguration>) => void
}

const GO_KINDS = new Set<string>([GoIDERunConfigurationKind.RunKindPackage, GoIDERunConfigurationKind.RunKindFiles, GoIDERunConfigurationKind.RunKindBuild, GoIDERunConfigurationKind.RunKindTest])
const DEBUG_KINDS = new Set<string>([GoIDERunConfigurationKind.RunKindPackage, GoIDERunConfigurationKind.RunKindBuild])
const PROFILES = [['', 'None'], ['cpu', 'CPU (cpu.pprof)'], ['mem', 'Memory (mem.pprof)'], ['block', 'Blocking (block.pprof)'], ['mutex', 'Mutex (mutex.pprof)'], ['trace', 'Execution trace (trace.out)']] as const

const input = 'gs-input gs-mono'
const label = 'gs-field-label'

/** Parametri di esecuzione: env file, porta, piattaforma, race, coverage, profiling, flag Delve, task prima/dopo. */
export function GoStudioRunParameters({ draft, configs, patch }: Props) {
  const goKind = GO_KINDS.has(draft.kind)
  const isTest = draft.kind === GoIDERunConfigurationKind.RunKindTest
  const tasks = (field: 'preRun' | 'postRun', title: string, hint: string) => (
    <RunTaskList draft={draft} configs={configs} patch={patch} field={field} title={title} hint={hint} />
  )

  return (
    <section className="mt-5 border-t border-border-1 pt-4">
      <h3 className="gs-section-title mb-3">Execution options</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Env file<input value={draft.envFile ?? ''} onChange={(event) => patch({ envFile: event.target.value })} placeholder=".env (relative to working dir)" className={input} /></label>
        <label className={label}>Port (sets PORT, checked free before start)
          <input type="number" min={0} max={65535} value={draft.port || ''} onChange={(event) => patch({ port: Number(event.target.value) || 0 })} placeholder="8080" className={input} />
        </label>
        {goKind && <>
          <label className={label}>GOOS<input value={draft.goos ?? ''} onChange={(event) => patch({ goos: event.target.value.trim() })} placeholder="Host OS · linux, windows, darwin" className={input} /></label>
          <label className={label}>GOARCH<input value={draft.goarch ?? ''} onChange={(event) => patch({ goarch: event.target.value.trim() })} placeholder="Host arch · amd64, arm64" className={input} /></label>
          <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-text-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.race} onChange={(event) => patch({ race: event.target.checked })} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />Race detector (-race)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.coverage} onChange={(event) => patch({ coverage: event.target.checked })} className="h-[15px] w-[15px] accent-[var(--color-accent)]" />Coverage (-cover{isTest ? '' : ', data in .gocoverdata'})</label>
          </div>
        </>}
        {isTest && (
          <label className={label}>Profiling
            <select value={draft.profile ?? ''} onChange={(event) => patch({ profile: event.target.value })} className={input}>
              {PROFILES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
        )}
        {DEBUG_KINDS.has(draft.kind) && (
          <label className={label}>Debug build flags (Delve)<input value={(draft.debugFlags ?? []).join(' ')} onChange={(event) => patch({ debugFlags: event.target.value.split(/\s+/).filter(Boolean) })} placeholder="-gcflags=all=-N" className={input} /></label>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        {tasks('preRun', 'Before launch', 'Run other configurations first, e.g. docker compose up or a make target. A failure stops the launch.')}
        <ArrowRight size={14} className="mt-8 text-text-4" />
        {tasks('postRun', 'After it finishes', 'Run cleanup or reports after this configuration ends.')}
      </div>
    </section>
  )
}

interface TaskListProps extends Props {
  field: 'preRun' | 'postRun'
  title: string
  hint: string
  /** Configurations that cannot be tasks here (e.g. a compound's own members). */
  exclude?: readonly string[]
}

/** Ordered list of other configurations run before or after this one. */
export function RunTaskList({ draft, configs, patch, field, title, hint, exclude = [] }: TaskListProps) {
  const ids = draft[field] ?? []
  const available = configs.filter((config) => config.id && config.id !== draft.id && !ids.includes(config.id)
    && !exclude.includes(config.id) && config.kind !== GoIDERunConfigurationKind.RunKindCompound)
  return (
    <div>
      <div className="gs-label">{title}</div>
      <div className="gs-surface mt-1.5 min-h-[36px] p-1">
        {ids.length === 0 && <p className="gs-hint px-1.5 py-1.5">{hint}</p>}
        {ids.map((id, index) => {
          const name = configs.find((config) => config.id === id)?.name ?? 'Deleted configuration'
          return (
            <div key={id} className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[12.5px] text-text-2 hover:bg-surface-2/60">
              <span className="w-4 text-[11px] text-text-4">{index + 1}</span>{name}
              <button type="button" title="Remove" onClick={() => patch({ [field]: ids.filter((item) => item !== id) })} className="ml-auto grid h-5 w-5 place-items-center rounded text-text-4 hover:text-danger"><X size={10} /></button>
            </div>
          )
        })}
        {available.length > 0 && (
          <label className="flex h-8 items-center gap-1.5 px-1.5 text-[12px] text-accent">
            <Plus size={10} />
            <select value="" onChange={(event) => event.target.value && patch({ [field]: [...ids, event.target.value] })} className="h-7 flex-1 cursor-pointer bg-transparent text-[12px] text-accent outline-none">
              <option value="">Add configuration…</option>
              {available.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
