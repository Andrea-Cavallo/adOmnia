import { useCallback, useEffect, useState } from 'react'
import { BookCheck, FileText, Plus, RefreshCw } from 'lucide-react'
import { AcceptanceScenarioModel, AcceptanceStatus, listAcceptanceScenarios, saveAcceptanceScenario, touchedAcceptanceScenarios, type AcceptanceScenario, type AgentTask } from '@/lib/agent-task-api'
import { useAgentTaskStore } from '@/stores/agentTasks'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField } from './CodeStudioModal'

const OUTCOME_CLASS: Record<string, string> = { passed: 'text-success', failed: 'text-danger', error: 'text-warning', not_run: 'text-text-3' }

/** Latest outcome of the scenario's criteria on this task, measured by its verifications. */
export function scenarioOutcome(task: AgentTask, scenarioId: string): string {
  const linked = (task.verifications ?? []).filter((verification) => verification.scenarioId === scenarioId)
  if (!linked.length) return ''
  const outcomes: string[] = linked.map((verification) => [...(task.evidences ?? [])].reverse().find((evidence) => evidence.verificationId === verification.id)?.outcome ?? 'not_run')
  if (outcomes.includes('failed')) return 'failed'
  if (outcomes.includes('error')) return 'error'
  if (outcomes.every((outcome) => outcome === 'passed')) return 'passed'
  return 'not_run'
}

const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)

function NewScenario({ root, onSaved, onCancel }: { root: string; onSaved: () => void; onCancel: () => void }) {
  const [id, setId] = useState('')
  const [title, setTitle] = useState('')
  const [routes, setRoutes] = useState('')
  const [files, setFiles] = useState('')
  const [criterion, setCriterion] = useState('')
  const [method, setMethod] = useState('GET')
  const [url, setUrl] = useState('')
  const [expectedStatus, setExpectedStatus] = useState(200)
  const [error, setError] = useState('')
  const save = async () => {
    setError('')
    try {
      await saveAcceptanceScenario(root, new AcceptanceScenarioModel({
        id, title, status: AcceptanceStatus.StatusActive, routes: lines(routes), files: lines(files),
        criteria: criterion.trim() ? [{ id: 'c1', text: criterion, check: url.trim() ? { kind: 'request', method, url: url.trim(), expectedStatus } : undefined }] : [],
      }))
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return <div className="flex flex-col gap-2 rounded border border-border-1 p-2">
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    <div className="flex flex-wrap gap-2">
      <CodeStudioField label="ID" hint="File name in .adomnia/acceptance"><input className="gs-input h-7 w-40 font-mono text-[11px]" value={id} placeholder="orders-404" onChange={(event) => setId(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Title" className="min-w-48 flex-1"><input className="gs-input h-7 text-[12px]" value={title} onChange={(event) => setTitle(event.target.value)} /></CodeStudioField>
    </div>
    <div className="flex flex-wrap gap-2">
      <CodeStudioField label="Routes" hint="One per line: METHOD /path" className="min-w-48 flex-1"><textarea className="gs-input min-h-12 font-mono text-[11px]" value={routes} onChange={(event) => setRoutes(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Files" hint="One per line, relative" className="min-w-48 flex-1"><textarea className="gs-input min-h-12 font-mono text-[11px]" value={files} onChange={(event) => setFiles(event.target.value)} /></CodeStudioField>
    </div>
    <CodeStudioField label="Criterion"><input className="gs-input h-7 text-[12px]" value={criterion} placeholder="Unknown order ids return 404" onChange={(event) => setCriterion(event.target.value)} /></CodeStudioField>
    <div className="flex flex-wrap items-end gap-2">
      <CodeStudioField label="Check: method"><select className="gs-input h-7 w-24 text-[11px]" value={method} onChange={(event) => setMethod(event.target.value)}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((item) => <option key={item}>{item}</option>)}</select></CodeStudioField>
      <CodeStudioField label="URL" hint="Optional: without it the criterion is prose only" className="min-w-48 flex-1"><input className="gs-input h-7 font-mono text-[11px]" value={url} placeholder="http://localhost:8080/orders/unknown" onChange={(event) => setUrl(event.target.value)} /></CodeStudioField>
      <CodeStudioField label="Expected status"><input type="number" min={100} max={599} className="gs-input h-7 w-24 text-[11px]" value={expectedStatus} onChange={(event) => setExpectedStatus(Number(event.target.value) || 200)} /></CodeStudioField>
    </div>
    <div className="flex gap-2"><span className="flex-1" /><CodeStudioButton small onClick={onCancel}>Cancel</CodeStudioButton><CodeStudioButton small variant="primary" onClick={() => void save()}>Save scenario</CodeStudioButton></div>
  </div>
}

/** Acceptance scenarios of the project: link them to the task to run their criteria as verifications. */
export function CodeStudioAgentTaskScenarios({ task, active }: { task: AgentTask; active: boolean }) {
  const [scenarios, setScenarios] = useState<AcceptanceScenario[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [touched, setTouched] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      const result = await listAcceptanceScenarios(task.root)
      setScenarios(result.scenarios ?? [])
      setProblems(result.problems ?? [])
      // Solo i collegamenti espliciti ai file: un diff non modifica mai gli scenari.
      setTouched(task.workspace?.state === 'ready' ? await touchedAcceptanceScenarios(task.id).catch(() => []) : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [task.root, task.id, task.workspace?.state])
  useEffect(() => { void reload() }, [reload])
  const add = async (scenarioId: string) => {
    setError('')
    try { await useAgentTaskStore.getState().addScenario(task.id, scenarioId) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <section className="agent-task-section flex flex-col gap-2" aria-label="Acceptance scenarios">
    <div className="flex items-center gap-2">
      <h3 className="gs-section-title flex-1"><BookCheck size={13} className="mr-1 inline" />Acceptance scenarios</h3>
      <CodeStudioButton small icon={RefreshCw} title="Read .adomnia/acceptance again" onClick={() => void reload()}>Reload</CodeStudioButton>
      {!creating && <CodeStudioButton small icon={Plus} onClick={() => setCreating(true)}>New scenario</CodeStudioButton>}
    </div>
    {error && <CodeStudioAlert>{error}</CodeStudioAlert>}
    {problems.map((problem) => <CodeStudioAlert key={problem} tone="warning">{problem}</CodeStudioAlert>)}
    {creating && <NewScenario root={task.root} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); void reload() }} />}
    {scenarios.length === 0 && !creating
      ? <p className="text-[11px] text-text-3">No scenario in <span className="font-mono">.adomnia/acceptance</span>. A scenario is a requirement versioned with the code: its criteria with a check run as verifications of the task.</p>
      : <ul className="flex flex-col">{scenarios.map((scenario) => {
        const outcome = scenarioOutcome(task, scenario.id)
        const executable = (scenario.criteria ?? []).filter((criterion) => criterion.check).length
        const linked = (task.verifications ?? []).some((verification) => verification.scenarioId === scenario.id)
        return <li key={scenario.id} className="flex flex-col gap-0.5 rounded px-2 py-1.5 hover:bg-surface-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-text-4">{scenario.id}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-text-1" title={scenario.description || scenario.title}>{scenario.title}</span>
            <span className="text-[10px] text-text-4">{scenario.status}</span>
            {outcome && <span className={`text-[10px] font-medium ${OUTCOME_CLASS[outcome] ?? ''}`}>{outcome.replace('_', ' ')}</span>}
            {touched.includes(scenario.id) && <span className="text-[10px] font-medium text-warning" title="A file linked to this scenario changed in the task workspace">touched by this change</span>}
            {touched.includes(scenario.id) && linked && <CodeStudioButton small disabled={active} title="Run this scenario's verifications on the current content" onClick={() => void useAgentTaskStore.getState().startVerifications(task.id, (task.verifications ?? []).filter((verification) => verification.scenarioId === scenario.id).map((verification) => verification.id)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>Re-run</CodeStudioButton>}
            <CodeStudioButton small disabled={active || !executable || linked} title={!executable ? 'No criterion has a check' : linked ? 'Already linked to this task: run it from Verifications' : 'Add its checks to the task verifications'} onClick={() => void add(scenario.id)}>Add to task</CodeStudioButton>
          </div>
          <p className="text-[10px] text-text-4">
            {(scenario.criteria ?? []).length} criteria · {executable} with a check
            {(scenario.routes ?? []).map((route) => <span key={route} className="ml-2 font-mono">{route}</span>)}
          </p>
          {(scenario.files ?? []).length > 0 && <div className="flex flex-wrap gap-2">{scenario.files!.map((file) => <button key={file} type="button" className="flex items-center gap-1 font-mono text-[10px] text-accent hover:underline" title="Open in the editor" onClick={() => void useCodeStudioStore.getState().openDocument(file)}><FileText size={10} />{file}</button>)}</div>}
        </li>
      })}</ul>}
  </section>
}
