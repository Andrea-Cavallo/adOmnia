import { ArrowRight, ArrowUp, ArrowDown, Plus, X } from 'lucide-react'
import { GoIDERunConfigurationKind, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import { CodeStudioRunSchemaFields } from './CodeStudioRunSchemaFields'

interface Props {
  draft: GoIDERunConfiguration
  configs: GoIDERunConfiguration[]
  patch: (change: Partial<GoIDERunConfiguration>) => void
}


const input = 'gs-input gs-mono'
const label = 'gs-field-label'

/** Parametri di esecuzione: env file, porta, campi del linguaggio (da schema), task prima/dopo. */
export function CodeStudioRunParameters({ draft, configs, patch }: Props) {
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
      </div>
      <CodeStudioRunSchemaFields draft={draft} patch={patch} />
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

const NO_EXCLUSIONS: readonly string[] = []

/** Ordered list of other configurations run before or after this one. */
export function RunTaskList({ draft, configs, patch, field, title, hint, exclude = NO_EXCLUSIONS }: TaskListProps) {
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
              <button type="button" title="Move task up" disabled={index === 0} onClick={() => { const ordered = [...ids]; [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]]; patch({ [field]: ordered }) }} className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon ml-auto"><ArrowUp size={11} /></button>
              <button type="button" title="Move task down" disabled={index === ids.length - 1} onClick={() => { const ordered = [...ids]; [ordered[index + 1], ordered[index]] = [ordered[index], ordered[index + 1]]; patch({ [field]: ordered }) }} className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon"><ArrowDown size={11} /></button>
              <button type="button" title="Remove" onClick={() => patch({ [field]: ids.filter((item) => item !== id) })} className="ml-auto grid h-5 w-5 place-items-center rounded text-text-4 hover:text-danger"><X size={10} /></button>
            </div>
          )
        })}
        {available.length > 0 && (
          <label className="flex h-8 items-center gap-1.5 px-1.5 text-[12px] text-accent">
            <Plus size={10} />
            <select value="" onChange={(event) => event.target.value && patch({ [field]: [...ids, event.target.value] })} className="gs-input h-7 flex-1">
              <option value="">Add configuration…</option>
              {available.map((config) => <option key={config.id} value={config.id}>{config.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
