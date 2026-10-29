import './codeStudioAgentTaskComposer.css'
import { useEffect, useState } from 'react'
import { ArrowRight, Bug, Code2, FileCode2, Plus, Search, X } from 'lucide-react'
import { Intent, type AgentTask } from '@/lib/agent-task-api'
import { quickOpenGoIDEFiles, type GoIDEQuickOpenResult, type GoIDESession } from '@/lib/code-studio-api'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { useClaudeCodeStore } from '@/stores/claudeCode'
import { useMilkStore } from '@/stores/milk'
import { agentTaskDraft, emptyAgentTaskDraft } from './agentTaskComposer'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal, CodeStudioPalette } from './CodeStudioModal'

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

interface Props {
  session: GoIDESession
  task: AgentTask | null
  open: boolean
  onClose: () => void
}

export function CodeStudioAgentTaskEditor({ session, task, open, onClose }: Props) {
  const [draft, setDraft] = useState(() => task ? agentTaskDraft(task) : emptyAgentTaskDraft(session.project.realPath))
  const [criteria, setCriteria] = useState(draft.criteria.join('\n'))
  const [dependencies, setDependencies] = useState(draft.dependencies.join('\n'))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GoIDEQuickOpenResult[]>([])
  const [error, setError] = useState('')
  const busy = useAgentTaskStore((state) => state.busyById[task?.id ?? 'new'])
  const milkStatus = useMilkStore((state) => state.status)
  const claudeStatus = useClaudeCodeStore((state) => state.status)
  const agentStatus = draft.agent === 'claude' ? claudeStatus : milkStatus
  const capabilities = agentStatus?.capabilities
  const readiness = agentStatus?.state === 'ready' ? 'ready' : agentStatus?.state ? agentStatus.state.replace(/-/g, ' ') : 'not started'

  useEffect(() => {
    if (!pickerOpen) return
    let live = true
    void quickOpenGoIDEFiles(session.id, query, 30).then((files) => { if (live) setResults(files) }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [pickerOpen, query, session.id])

  const save = async () => {
    const next = { ...draft, criteria: lines(criteria), dependencies: lines(dependencies) }
    if (!next.objective.trim()) { setError('Describe the objective before saving the task.'); return }
    setError('')
    try {
      if (task) await useAgentTaskStore.getState().update(task.id, next)
      else await useAgentTaskStore.getState().create(next)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return <>
    <CodeStudioModal open={open} onClose={onClose} title={task ? 'Edit agent task' : 'New agent task'} subtitle="Define the work. Review its context before starting." size="xl" divided persistent={busy} className="agent-task-composer" bodyClassName="agent-composer-body" footerStart={<span className="agent-composer-draft-note">Draft only · no agent starts on save</span>} footer={<><CodeStudioButton variant="ghost" disabled={busy} onClick={onClose}>Cancel</CodeStudioButton><CodeStudioButton variant="primary" loading={busy} onClick={() => void save()}>{task ? 'Save changes' : 'Create draft'}<ArrowRight size={14} /></CodeStudioButton></>}>
      {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
      <div className="agent-composer-project"><span>PROJECT</span><code title={session.project.realPath}>{session.project.realPath}</code></div>
      <div className="agent-composer-layout">
        <section className="agent-composer-brief" aria-label="Task brief">
          <div className="agent-composer-section-heading"><span>01</span><h3>The task</h3></div>
          <CodeStudioField label="Objective" hint="Describe the change, investigation or outcome you need."><textarea aria-label="Objective" data-autofocus className="gs-input agent-composer-objective" rows={6} value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} placeholder="What should the agent change or explain?" /></CodeStudioField>
          <CodeStudioField label="Completion criteria" hint="One checkable result per line."><textarea aria-label="Completion criteria" className="gs-input" rows={4} value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="How will you know this task is complete?" /></CodeStudioField>
          <CodeStudioField label="Dependencies and constraints" hint="One instruction per line; files are added separately."><textarea aria-label="Dependencies and constraints" className="gs-input" rows={3} value={dependencies} onChange={(event) => setDependencies(event.target.value)} placeholder="Required behavior, dependencies or boundaries" /></CodeStudioField>
        </section>
        <aside className="agent-composer-context" aria-label="Task configuration">
          <div className="agent-composer-section-heading"><span>02</span><h3>Setup & context</h3></div>
          <div className="agent-composer-intent"><span className="gs-label">Intent</span><div className="agent-composer-intent-options">{[
            { value: Intent.IntentImplementation, label: 'Build', icon: Code2 },
            { value: Intent.IntentBugfix, label: 'Fix', icon: Bug },
            { value: Intent.IntentAnalysis, label: 'Analyze', icon: Search },
          ].map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={draft.intent === value} onClick={() => setDraft({ ...draft, intent: value })}><Icon size={14} />{label}</button>)}</div></div>
          <CodeStudioField label="Agent"><select aria-label="Agent" className="gs-input" value={draft.agent} onChange={(event) => setDraft({ ...draft, agent: event.target.value })}><option value="milk">milk</option><option value="claude">Claude Code</option><option value="pi">Pi</option></select></CodeStudioField>
          <p className="gs-hint" role="status">{draft.agent === 'claude' ? 'Claude Code' : 'milk'} · {readiness}{agentStatus?.model ? ` · ${agentStatus.model}` : ''}{capabilities ? ` · ACP v${capabilities.protocolVersion}${capabilities.readTextFile ? ' · reads project files itself' : ''}` : ''}{draft.intent === Intent.IntentAnalysis ? ' · analysis is not enforced read-only: the agent can still edit files' : " · writes in this project's working tree"}</p>
          <section className="agent-composer-files" aria-label="Project files">
            <div className="agent-composer-files-heading"><span className="gs-label">Project files</span><span>{draft.paths.length}</span></div>
            <p className="gs-hint">Read during context preview. Excluded files are never attached.</p>
            {draft.paths.length > 0 ? <ul className="agent-composer-file-list">{draft.paths.map((path) => <li key={path}><FileCode2 size={14} /><span title={path}>{path}</span><button type="button" aria-label={`Remove ${path}`} onClick={() => setDraft({ ...draft, paths: draft.paths.filter((item) => item !== path) })}><X size={13} /></button></li>)}</ul> : <p className="agent-composer-no-files">No files selected</p>}
            <CodeStudioButton small icon={Plus} onClick={() => setPickerOpen(true)}>Add project file</CodeStudioButton>
          </section>
          <details className="agent-composer-limits"><summary>Execution limits<span>{draft.limits.timeoutMinutes} min · {Math.round(draft.limits.maxContextBytes / 1024)} KiB</span></summary>
            <CodeStudioField label="Timeout (minutes)"><input aria-label="Timeout (minutes)" className="gs-input" type="number" min={1} max={240} value={draft.limits.timeoutMinutes} onChange={(event) => setDraft({ ...draft, limits: { ...draft.limits, timeoutMinutes: event.target.valueAsNumber } })} /></CodeStudioField>
            <CodeStudioField label="Context limit (KiB)"><input aria-label="Context limit (KiB)" className="gs-input" type="number" min={1} max={256} value={Math.round(draft.limits.maxContextBytes / 1024)} onChange={(event) => setDraft({ ...draft, limits: { ...draft.limits, maxContextBytes: event.target.valueAsNumber * 1024 } })} /></CodeStudioField>
          </details>
        </aside>
      </div>
    </CodeStudioModal>
    <CodeStudioPalette open={pickerOpen} onClose={() => setPickerOpen(false)} ariaLabel="Add a project file" input={<input autoFocus className="gs-palette-input" aria-label="Search project files" placeholder="Search project files" value={query} onChange={(event) => setQuery(event.target.value)} />}>
      {results.length ? results.map((file) => <button key={file.relativePath} type="button" className="gs-palette-item" onClick={() => { setDraft({ ...draft, paths: [...new Set([...draft.paths, file.relativePath])] }); setPickerOpen(false); setQuery('') }}><span className="gs-palette-item-title gs-mono">{file.relativePath}</span></button>) : <p className="gs-palette-empty">No matching project files.</p>}
    </CodeStudioPalette>
  </>
}
