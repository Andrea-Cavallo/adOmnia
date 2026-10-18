import { CodeStudioRunConfigHistory } from './CodeStudioRunConfigHistory'
import { useState } from 'react'
import { Settings2, Leaf, ListOrdered, Monitor, RotateCcw } from 'lucide-react'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import { commonRunFields, runTemplates, templateFor } from '@/lib/code-studio/runFormSchema'
import { draftRecord, emptyRunConfiguration, templateKey } from '@/lib/code-studio/runFormTypes'
import { SchemaGrid, CodeStudioRunSchemaFields } from './CodeStudioRunSchemaFields'
import { CodeStudioEntryList } from './CodeStudioEntryList'
import { RunTaskList } from './CodeStudioRunParameters'
import { CodeStudioRunTarget, supportsRemoteTarget } from './CodeStudioRunTarget'

interface Props {
  draft: GoIDERunConfiguration
  configs: GoIDERunConfiguration[]
  patch: (change: Partial<GoIDERunConfiguration>) => void
  onReady: (ready: boolean) => void
}
const sections = [
  { id: 'configuration', label: 'Configuration', icon: Settings2 },
  { id: 'environment', label: 'Environment', icon: Leaf },
  { id: 'tasks', label: 'Before / after launch', icon: ListOrdered },
  { id: 'target', label: 'Run target', icon: Monitor },
  { id: 'restart', label: 'Restart', icon: RotateCcw },
] as const
export function RunConfigForm({ draft, configs, patch, onReady }: Props) {
  const [section, setSection] = useState<string>('configuration')
  const template = templateFor(draft)
  const isCompound = draft.kind === 'compound'
  const dockerKind = draft.kind === 'docker-build' || draft.kind === 'docker-run'
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="space-y-3 border-b border-border-1 p-4">
      <div className="flex items-end gap-3">
        <label className="gs-field-label min-w-0 flex-1">Name<input required value={draft.name} onChange={event => patch({ name: event.target.value })} className="gs-input" /></label>
        <label className="gs-check"><input type="checkbox" checked={!!draft.pinned} onChange={event => patch({ pinned: event.target.checked })} />Pin</label>
        <label className="gs-check" title="Save in .adomnia/run-configurations.json to share through Git"><input type="checkbox" checked={!!draft.shared} onChange={event => patch({ shared: event.target.checked })} />Share (Git)</label>
      </div>
      <label className="gs-field-label">Provider / type
        <select value={templateKey(template)} className="gs-input" onChange={event => {
          const next = runTemplates.find(item => templateKey(item) === event.target.value)
          if (next) patch({ ...emptyRunConfiguration(draft.sessionId), id: draft.id, name: draft.name, pinned: draft.pinned, shared: draft.shared, order: draft.order, createdAt: draft.createdAt, updatedAt: draft.updatedAt, workingDirectory: draft.workingDirectory, environment: draft.environment, envFile: draft.envFile, preRun: draft.preRun, postRun: draft.postRun, restartOnSave: draft.restartOnSave, restartPolicy: draft.restartPolicy, compound: [], language: next.language, kind: next.kind as GoIDERunConfiguration['kind'], target: next.target ?? '', languageOptions: {}, remote: null })
        }}>
          {Array.from(new Set(runTemplates.map(item => item.group))).map(group => <optgroup key={group} label={group}>{runTemplates.filter(item => item.group === group).map(item => <option key={templateKey(item)} value={templateKey(item)}>{item.label}</option>)}</optgroup>)}
          {!runTemplates.some(item => templateKey(item) === templateKey(template)) && <option value={templateKey(template)}>{template.group} · {template.label}</option>}
        </select>
      </label>
    </div>
    <nav aria-label="Configuration sections" className="flex shrink-0 flex-wrap gap-1 border-b border-border-1 px-3 py-2">
      {sections.map(item => <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)} className={`gs-btn gs-btn-sm ${section === item.id ? 'gs-btn-secondary' : 'gs-btn-ghost'}`}><item.icon size={13} />{item.label}</button>)}
    </nav>
    <div className="min-h-0 flex-1 overflow-auto p-4" onInvalidCapture={event => {
      const control = event.target as HTMLElement
      const details = control.closest('details')
      if (details) details.open = true
      const panel = control.closest<HTMLElement>('[data-run-section]')
      if (panel) { setSection(panel.dataset.runSection ?? 'configuration') }
      requestAnimationFrame(() => control.focus())
    }}>
      <div data-run-section="configuration" hidden={section !== 'configuration'} className="space-y-4">
        <SchemaGrid fields={commonRunFields(draft)} values={draftRecord(draft)} set={(key, value) => patch({ [key]: value })} />
        <CodeStudioRunSchemaFields key={templateKey(template)} draft={draft} patch={patch} onReady={onReady} />
        {isCompound && <fieldset><legend className="gs-label">Configurations started together</legend>
          {configs.filter(config => config.id !== draft.id && config.kind !== 'compound').map(config => <label key={config.id} className="gs-check mt-2"><input type="checkbox" checked={(draft.compound ?? []).includes(config.id)} onChange={event => patch({ compound: event.target.checked ? [...(draft.compound ?? []), config.id] : (draft.compound ?? []).filter(id => id !== config.id) })} />{config.name}</label>)}
          {configs.length < 2 && <p className="gs-hint">Create the configurations to start together first.</p>}
        </fieldset>}
        {dockerKind && <DockerFields draft={draft} patch={patch} />}
        <CodeStudioRunConfigHistory draft={draft} />
      </div>
      <div data-run-section="environment" hidden={section !== 'environment'} className="space-y-3">
        <label className="gs-field-label">Environment preset<select className="gs-input" value={['.env.development', '.env.test', '.env.production'].includes(draft.envFile ?? '') ? draft.envFile! : ''} onChange={event => patch({ envFile: event.target.value })}>
          <option value="">Custom / inherited</option><option value=".env.development">Development</option><option value=".env.test">Test</option><option value=".env.production">Production</option>
        </select></label>
        <label className="gs-field-label">Environment file<input value={draft.envFile ?? ''} onChange={event => patch({ envFile: event.target.value })} placeholder=".env · .env.development · .env.test · .env.production" className="gs-input gs-mono" /></label>
        <p className="gs-hint">Path relative to the working directory. Configuration overrides take precedence over the file.</p>
        <label className="gs-field-label">Port<input type="number" min={0} max={65535} value={draft.port || ''} onChange={event => patch({ port: Number(event.target.value) || 0 })} className="gs-input gs-mono" /></label>
        <CodeStudioEntryList label="Environment overrides" empty="Inherit the process environment." entries={draft.environment ?? []} onChange={environment => patch({ environment })} />
      </div>
      <div data-run-section="tasks" hidden={section !== 'tasks'} className="space-y-5">
        <RunTaskList draft={draft} configs={configs} patch={patch} field="preRun" title="Before launch" hint="Run configurations in order. A failure stops the launch." exclude={draft.compound ?? []} />
        <RunTaskList draft={draft} configs={configs} patch={patch} field="postRun" title="After it finishes" hint="Cleanup and reports after execution." />
      </div>
      {section === 'target' && <div className="grid grid-cols-2 gap-3">{supportsRemoteTarget(draft.kind) ? <CodeStudioRunTarget draft={draft} patch={patch} /> : <p className="gs-hint col-span-2">This configuration uses the local runtime. For compound runs, set the target on each member.</p>}</div>}
      <div data-run-section="restart" hidden={section !== 'restart'} className="space-y-4">
        <label className="gs-field-label">After an unexpected shutdown<select value={draft.restartPolicy ?? ''} onChange={event => patch({ restartPolicy: event.target.value })} className="gs-input"><option value="">Ask before relaunching</option><option value="never">Never relaunch</option><option value="always">Relaunch automatically</option></select></label>
        {!isCompound && <label className="gs-check"><input type="checkbox" checked={!!draft.restartOnSave} onChange={event => patch({ restartOnSave: event.target.checked })} />Restart on save within this configuration’s language and working directory</label>}
      </div>
    </div>
  </div>
}
function DockerFields({ draft, patch }: Pick<Props, 'draft' | 'patch'>) {
  const docker = draft.docker ?? {}
  return <details className="rounded-md border border-border-1 p-3"><summary className="gs-label cursor-pointer">Container options</summary><div className="mt-3 space-y-3">
    <SchemaGrid fields={[
      { key: 'context', label: 'Build context' }, { key: 'tag', label: 'Image tag' }, { key: 'stage', label: 'Build stage' }, { key: 'noCache', label: 'No cache', type: 'toggle' },
      ...(draft.kind === 'docker-run' ? [{ key: 'ports', label: 'Published ports', type: 'list' }, { key: 'volumes', label: 'Volumes', type: 'list' }] : []),
    ]} values={docker as unknown as Record<string, unknown>} set={(key, value) => patch({ docker: { ...docker, [key]: value } })} />
    <CodeStudioEntryList label="Build args" empty="No build args." entries={docker.buildArgs ?? []} onChange={buildArgs => patch({ docker: { ...docker, buildArgs } })} />
  </div></details>
}
