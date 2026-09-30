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

const input = 'mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent'
const label = 'block text-[10px] font-medium text-text-3'

/** Parametri di esecuzione: env file, porta, piattaforma, race, coverage, profiling, flag Delve, task prima/dopo. */
export function GoStudioRunParameters({ draft, configs, patch }: Props) {
  const goKind = GO_KINDS.has(draft.kind)
  const isTest = draft.kind === GoIDERunConfigurationKind.RunKindTest
  const others = configs.filter((config) => config.id && config.id !== draft.id)

  const tasks = (field: 'preRun' | 'postRun', title: string, hint: string) => {
    const ids = draft[field] ?? []
    const available = others.filter((config) => !ids.includes(config.id))
    return (
      <div>
        <div className="text-[10px] font-medium text-text-3">{title}</div>
        <div className="mt-1 min-h-8 rounded border border-border-1 bg-surface-0 p-1">
          {ids.length === 0 && <p className="px-1 py-1 text-[9px] text-text-4">{hint}</p>}
          {ids.map((id, index) => {
            const name = configs.find((config) => config.id === id)?.name ?? 'Deleted configuration'
            return (
              <div key={id} className="flex h-6 items-center gap-1.5 rounded px-1 text-[11px] text-text-2 hover:bg-surface-2">
                <span className="w-3 text-[9px] text-text-4">{index + 1}</span>{name}
                <button type="button" title="Remove" onClick={() => patch({ [field]: ids.filter((item) => item !== id) })} className="ml-auto grid h-5 w-5 place-items-center rounded text-text-4 hover:text-danger"><X size={10} /></button>
              </div>
            )
          })}
          {available.length > 0 && (
            <label className="flex h-6 items-center gap-1 px-1 text-[10px] text-accent">
              <Plus size={10} />
              <select value="" onChange={(event) => event.target.value && patch({ [field]: [...ids, event.target.value] })} className="h-6 flex-1 cursor-pointer bg-transparent text-[10px] text-accent outline-none">
                <option value="">Add configuration…</option>
                {available.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="mt-4 border-t border-border-1 pt-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-3">Execution options</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>Env file<input value={draft.envFile ?? ''} onChange={(event) => patch({ envFile: event.target.value })} placeholder=".env (relative to working dir)" className={input} /></label>
        <label className={label}>Port (sets PORT, checked free before start)
          <input type="number" min={0} max={65535} value={draft.port || ''} onChange={(event) => patch({ port: Number(event.target.value) || 0 })} placeholder="8080" className={input} />
        </label>
        {goKind && <>
          <label className={label}>GOOS<input value={draft.goos ?? ''} onChange={(event) => patch({ goos: event.target.value.trim() })} placeholder="Host OS · linux, windows, darwin" className={input} /></label>
          <label className={label}>GOARCH<input value={draft.goarch ?? ''} onChange={(event) => patch({ goarch: event.target.value.trim() })} placeholder="Host arch · amd64, arm64" className={input} /></label>
          <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-medium text-text-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.race} onChange={(event) => patch({ race: event.target.checked })} className="accent-accent" />Race detector (-race)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!draft.coverage} onChange={(event) => patch({ coverage: event.target.checked })} className="accent-accent" />Coverage (-cover{isTest ? '' : ', data in .gocoverdata'})</label>
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
        <ArrowRight size={12} className="mt-7 text-text-4" />
        {tasks('postRun', 'After it finishes', 'Run cleanup or reports after this configuration ends.')}
      </div>
    </section>
  )
}
