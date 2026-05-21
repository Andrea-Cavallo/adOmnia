import { useEffect, useMemo, useState } from 'react'
import { Download, FileJson, FileText, FolderOpen, Play, Plus, Save, Trash2 } from 'lucide-react'
import { sendRequest } from '@/lib/sendRequest'
import { blankRequest, type AssertionResult, type HttpMethod, type RequestItem, uid } from '@/lib/types'
import { evaluateAssertions } from '@/lib/assertionEngine'
import { useEnvironmentsStore } from '@/stores/environments'
import { useServerPort, serverUrl, sidecarFetch } from '@/lib/useServerPort'
import { safeEval } from '@/lib/safeEval'

type FlowStatus = 'idle' | 'running' | 'ok' | 'error'
type FlowStepType = 'request' | 'condition' | 'wait' | 'script'
type ConditionOperator = 'exists' | 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'

interface FlowStep {
  id: string
  type: FlowStepType
  name: string
  request: RequestItem
  condition?: { variable: string; operator: ConditionOperator; value: string }
  waitMs?: number
  script?: string
  status: FlowStatus
  durationMs?: number
  error?: string
  assertionsPassed?: number
  assertionsTotal?: number
}

interface SavedFlow {
  id: string
  name: string
  steps: FlowStep[]
  updatedAt: string
}

interface FlowRunEntry {
  stepId: string
  stepName: string
  status: 'ok' | 'error'
  durationMs: number
  httpStatus: number
  error?: string
  assertions: AssertionResult[]
  extractedCount: number
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const STEP_TYPES: { value: FlowStepType; label: string }[] = [
  { value: 'request', label: 'Request' },
  { value: 'condition', label: 'Condition' },
  { value: 'wait', label: 'Wait' },
  { value: 'script', label: 'Script' },
]
const CONDITION_OPERATORS: ConditionOperator[] = ['exists', 'eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte']
const FLOW_STORAGE_KEY = 'adomnia.flows.v1'

function newStep(index: number, type: FlowStepType = 'request'): FlowStep {
  const request = blankRequest('GET')
  return {
    id: uid(),
    type,
    name: `step${index}`,
    request: { ...request, name: `Step ${index}` },
    condition: { variable: '', operator: 'exists', value: '' },
    waitMs: 500,
    script: 'return { nextValue: vars["step1.status"] || "" }',
    status: 'idle',
  }
}

function resetStepRuntime(step: FlowStep): FlowStep {
  return {
    ...step,
    status: 'idle',
    durationMs: undefined,
    error: undefined,
    assertionsPassed: undefined,
    assertionsTotal: undefined,
  }
}

function flattenJson(prefix: string, value: unknown, out: Record<string, string>) {
  if (value == null) return
  if (typeof value !== 'object') {
    out[prefix] = String(value)
    return
  }
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => flattenJson(`${prefix}.${index}`, item, out))
    return
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    flattenJson(prefix ? `${prefix}.${key}` : key, item, out)
  })
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function loadSavedFlows(): SavedFlow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLOW_STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function resolveVar(name: string, vars: Record<string, string>) {
  return vars[name] ?? vars[name.replace(/^\{\{|\}\}$/g, '')] ?? ''
}

function evaluateCondition(condition: FlowStep['condition'], vars: Record<string, string>) {
  if (!condition?.variable) return { passed: false, message: 'Condition variable is required' }
  const actual = resolveVar(condition.variable, vars)
  const expected = condition.value
  switch (condition.operator) {
    case 'exists': return { passed: actual !== '', message: actual !== '' ? 'value exists' : `${condition.variable} is empty or missing` }
    case 'eq': return { passed: actual === expected, message: `${actual} == ${expected}` }
    case 'neq': return { passed: actual !== expected, message: `${actual} != ${expected}` }
    case 'contains': return { passed: actual.includes(expected), message: `${actual} contains ${expected}` }
    case 'gt': return { passed: Number(actual) > Number(expected), message: `${actual} > ${expected}` }
    case 'lt': return { passed: Number(actual) < Number(expected), message: `${actual} < ${expected}` }
    case 'gte': return { passed: Number(actual) >= Number(expected), message: `${actual} >= ${expected}` }
    case 'lte': return { passed: Number(actual) <= Number(expected), message: `${actual} <= ${expected}` }
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)))
}

async function runFlowScript(source: string, vars: Record<string, string>): Promise<Record<string, string>> {
  try {
    const result = await safeEval(
      `const set = (key, value) => ({ [String(key)]: String(value ?? "") }); return (() => { ${source} })()`,
      { vars: Object.freeze({ ...vars }) }
    )
    if (result == null) return {}
    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Script must return an object like { token: "value" }')
    }
    return Object.fromEntries(Object.entries(result as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]))
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}

function exportRunMarkdown(flowName: string, run: FlowRunEntry[], vars: Record<string, string>) {
  const lines = [`# Flow run: ${flowName}`, '', `Generated: ${new Date().toISOString()}`, '']
  lines.push('| Step | Status | HTTP | Duration | Assertions |')
  lines.push('| --- | --- | ---: | ---: | ---: |')
  for (const item of run) {
    const passed = item.assertions.filter((a) => a.passed).length
    lines.push(`| ${item.stepName} | ${item.status.toUpperCase()} | ${item.httpStatus || '-'} | ${item.durationMs.toFixed(0)}ms | ${passed}/${item.assertions.length} |`)
    if (item.error) lines.push(`| ${item.stepName} error | ${item.error.replace(/\|/g, '\\|')} |  |  |  |`)
  }
  lines.push('', '## Extracted variables', '')
  Object.entries(vars).forEach(([key, value]) => lines.push(`- \`${key}\`: \`${value}\``))
  return lines.join('\n')
}

export function FlowsPanel() {
  const port = useServerPort()
  const envVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const [flowName, setFlowName] = useState('Untitled flow')
  const [activeFlowId, setActiveFlowId] = useState<string | null>(null)
  const [savedFlows, setSavedFlows] = useState<SavedFlow[]>([])
  const [steps, setSteps] = useState<FlowStep[]>([newStep(1)])
  const [vars, setVars] = useState<Record<string, string>>({})
  const [lastRun, setLastRun] = useState<FlowRunEntry[]>([])
  const [running, setRunning] = useState(false)
  const [recordUrl, setRecordUrl] = useState('')
  const [recordMethod, setRecordMethod] = useState<HttpMethod>('GET')
  const [recordPath, setRecordPath] = useState('')
  const [recordMessage, setRecordMessage] = useState('')

  useEffect(() => {
    setSavedFlows(loadSavedFlows())
  }, [])

  const sortedSavedFlows = useMemo(
    () => [...savedFlows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [savedFlows],
  )

  const persistFlows = (next: SavedFlow[]) => {
    setSavedFlows(next)
    localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(next))
  }

  const updateStep = (id: string, patch: Partial<FlowStep>) => {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step))
  }

  const updateRequest = (id: string, patch: Partial<RequestItem>) => {
    setSteps((current) => current.map((step) => (
      step.id === id ? { ...step, request: { ...step.request, ...patch } } : step
    )))
  }

  const saveFlow = () => {
    const id = activeFlowId ?? uid()
    const saved: SavedFlow = {
      id,
      name: flowName.trim() || 'Untitled flow',
      steps: steps.map(resetStepRuntime),
      updatedAt: new Date().toISOString(),
    }
    persistFlows([saved, ...savedFlows.filter((flow) => flow.id !== id)])
    setActiveFlowId(id)
    setFlowName(saved.name)
  }

  const loadFlow = (flow: SavedFlow) => {
    setActiveFlowId(flow.id)
    setFlowName(flow.name)
    setSteps(flow.steps.map(resetStepRuntime))
    setVars({})
    setLastRun([])
  }

  const deleteFlow = (id: string) => {
    persistFlows(savedFlows.filter((flow) => flow.id !== id))
    if (activeFlowId === id) setActiveFlowId(null)
  }

  const runFlow = async () => {
    setRunning(true)
    setLastRun([])
    setSteps((current) => current.map(resetStepRuntime))
    let nextVars = { ...envVars(), ...vars }
    const runEntries: FlowRunEntry[] = []

    for (const step of steps) {
      updateStep(step.id, { status: 'running', error: undefined })
      const start = performance.now()

      if (step.type === 'condition') {
        const result = evaluateCondition(step.condition, nextVars)
        const durationMs = performance.now() - start
        const entry: FlowRunEntry = {
          stepId: step.id,
          stepName: step.name,
          status: result.passed ? 'ok' : 'error',
          durationMs,
          httpStatus: 0,
          error: result.passed ? undefined : result.message,
          assertions: [],
          extractedCount: 0,
        }
        runEntries.push(entry)
        setLastRun([...runEntries])
        updateStep(step.id, { status: result.passed ? 'ok' : 'error', durationMs, error: result.passed ? undefined : result.message })
        if (!result.passed) {
          setRunning(false)
          setVars(nextVars)
          return
        }
        continue
      }

      if (step.type === 'wait') {
        await wait(step.waitMs ?? 0)
        const durationMs = performance.now() - start
        runEntries.push({ stepId: step.id, stepName: step.name, status: 'ok', durationMs, httpStatus: 0, assertions: [], extractedCount: 0 })
        setLastRun([...runEntries])
        updateStep(step.id, { status: 'ok', durationMs })
        continue
      }

      if (step.type === 'script') {
        try {
          const extracted = await runFlowScript(step.script ?? '', nextVars)
          nextVars = { ...nextVars, ...extracted }
          const durationMs = performance.now() - start
          runEntries.push({ stepId: step.id, stepName: step.name, status: 'ok', durationMs, httpStatus: 0, assertions: [], extractedCount: Object.keys(extracted).length })
          setVars(nextVars)
          setLastRun([...runEntries])
          updateStep(step.id, { status: 'ok', durationMs })
        } catch (e) {
          const durationMs = performance.now() - start
          const error = e instanceof Error ? e.message : String(e)
          runEntries.push({ stepId: step.id, stepName: step.name, status: 'error', durationMs, httpStatus: 0, error, assertions: [], extractedCount: 0 })
          setLastRun([...runEntries])
          updateStep(step.id, { status: 'error', durationMs, error })
          setRunning(false)
          setVars(nextVars)
          return
        }
        continue
      }

      const response = await sendRequest(step.request, nextVars)
      const durationMs = performance.now() - start
      const assertions = evaluateAssertions(step.request.assertions, response)
      const failedAssertions = assertions.filter((assertion) => !assertion.passed)

      if (response.error || response.status >= 400 || failedAssertions.length > 0) {
        const error = response.error
          ? response.error.message
          : failedAssertions.length > 0
            ? `${failedAssertions.length} assertion failed`
            : `HTTP ${response.status}`
        const entry: FlowRunEntry = {
          stepId: step.id,
          stepName: step.name,
          status: 'error',
          durationMs,
          httpStatus: response.status,
          error,
          assertions,
          extractedCount: 0,
        }
        runEntries.push(entry)
        setLastRun([...runEntries])
        updateStep(step.id, {
          status: 'error',
          durationMs,
          error,
          assertionsPassed: assertions.length - failedAssertions.length,
          assertionsTotal: assertions.length,
        })
        setRunning(false)
        setVars(nextVars)
        return
      }

      const extracted: Record<string, string> = {}
      try {
        flattenJson(step.name, JSON.parse(response.body), extracted)
      } catch {
        extracted[`${step.name}.body`] = response.body
      }
      extracted[`${step.name}.status`] = String(response.status)
      nextVars = { ...nextVars, ...extracted }
      setVars(nextVars)

      const entry: FlowRunEntry = {
        stepId: step.id,
        stepName: step.name,
        status: 'ok',
        durationMs,
        httpStatus: response.status,
        assertions,
        extractedCount: Object.keys(extracted).length,
      }
      runEntries.push(entry)
      setLastRun([...runEntries])
      updateStep(step.id, {
        status: 'ok',
        durationMs,
        assertionsPassed: assertions.length,
        assertionsTotal: assertions.length,
      })
    }
    setRunning(false)
  }

  const recordToMock = async () => {
    const url = serverUrl(port, '/mock/record')
    if (!url || !recordUrl) return
    setRecordMessage('')
    try {
      const res = await sidecarFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: recordUrl,
          method: recordMethod,
          mockPath: recordPath || undefined,
          mockMethod: recordMethod,
          headers: {},
        }),
      })
      const data = await res.json()
      setRecordMessage(res.ok ? `Recorded ${data.endpoint?.method ?? recordMethod} ${data.endpoint?.path ?? recordPath}` : data.error || 'Record failed')
    } catch (e) {
      setRecordMessage(String(e))
    }
  }

  const exportFlowJson = () => downloadBlob(
    JSON.stringify({ name: flowName, steps: steps.map(resetStepRuntime), vars, lastRun }, null, 2),
    `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}.json`,
    'application/json',
  )

  const exportFlowMarkdown = () => downloadBlob(
    exportRunMarkdown(flowName, lastRun, vars),
    `${flowName.replace(/[^\w.-]+/g, '-').toLowerCase() || 'flow'}-run.md`,
    'text/markdown',
  )

  return (
    <div className="flex-1 grid grid-cols-[1fr_320px] min-h-0">
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-1">
          <h2 className="text-sm font-semibold text-text-1">Flows</h2>
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="h-7 w-52 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1"
          />
          <button onClick={saveFlow} className="flex items-center gap-1 px-2 py-1 border border-border-2 rounded text-xs text-text-3 hover:text-text-1">
            <Save size={12} /> Save
          </button>
          <button onClick={() => setSteps((s) => [...s, newStep(s.length + 1)])} className="flex items-center gap-1 px-2 py-1 border border-border-2 rounded text-xs text-text-3 hover:text-text-1">
            <Plus size={12} /> Step
          </button>
          <button onClick={exportFlowJson} className="flex items-center gap-1 px-2 py-1 border border-border-2 rounded text-xs text-text-3 hover:text-text-1">
            <FileJson size={12} /> JSON
          </button>
          <button onClick={exportFlowMarkdown} disabled={lastRun.length === 0} className="flex items-center gap-1 px-2 py-1 border border-border-2 rounded text-xs text-text-3 hover:text-text-1 disabled:opacity-40">
            <FileText size={12} /> Report
          </button>
          <button onClick={runFlow} disabled={running || steps.length === 0} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded text-xs disabled:opacity-50">
            <Play size={12} /> {running ? 'Running' : 'Run Flow'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {steps.map((step, index) => (
            <div key={step.id} className="bg-surface-1 border border-border-1 rounded p-3 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${step.status === 'ok' ? 'bg-green-400' : step.status === 'error' ? 'bg-error' : step.status === 'running' ? 'bg-accent' : 'bg-text-4'}`} />
                <input value={step.name} onChange={(e) => updateStep(step.id, { name: e.target.value })} className="w-32 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
                <select value={step.type} onChange={(e) => updateStep(step.id, { type: e.target.value as FlowStepType })} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1">
                  {STEP_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                {step.type === 'request' && (
                  <>
                    <select value={step.request.method} onChange={(e) => updateRequest(step.id, { method: e.target.value as HttpMethod })} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1">
                      {METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                    <input value={step.request.url} onChange={(e) => updateRequest(step.id, { url: e.target.value })} placeholder="https://api.your-domain.com" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
                  </>
                )}
                {step.type === 'condition' && (
                  <>
                    <input value={step.condition?.variable ?? ''} onChange={(e) => updateStep(step.id, { condition: { ...(step.condition ?? { operator: 'exists', value: '' }), variable: e.target.value } })} placeholder="variable, e.g. step1.status" className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
                    <select value={step.condition?.operator ?? 'exists'} onChange={(e) => updateStep(step.id, { condition: { ...(step.condition ?? { variable: '', value: '' }), operator: e.target.value as ConditionOperator } })} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1">
                      {CONDITION_OPERATORS.map((op) => <option key={op}>{op}</option>)}
                    </select>
                    <input value={step.condition?.value ?? ''} onChange={(e) => updateStep(step.id, { condition: { ...(step.condition ?? { variable: '', operator: 'exists' }), value: e.target.value } })} placeholder="expected" className="w-36 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
                  </>
                )}
                {step.type === 'wait' && (
                  <div className="flex flex-1 items-center gap-2">
                    <input type="number" min={0} value={step.waitMs ?? 0} onChange={(e) => updateStep(step.id, { waitMs: Math.max(0, parseInt(e.target.value) || 0) })} className="w-28 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
                    <span className="text-[10px] text-text-4">milliseconds before next step</span>
                  </div>
                )}
                {step.type === 'script' && (
                  <div className="flex-1 text-[10px] text-text-4">Return an object to merge variables, e.g. <span className="font-mono text-text-3">{'{ token: vars.loginToken }'}</span></div>
                )}
                <button onClick={() => setSteps((s) => s.filter((item) => item.id !== step.id))} disabled={steps.length === 1} className="p-1 text-text-4 hover:text-error disabled:opacity-30" title="Remove"><Trash2 size={13} /></button>
              </div>
              {step.type === 'request' && ['POST', 'PUT', 'PATCH'].includes(step.request.method) && (
                <textarea
                  value={step.request.bodies[step.request.activeBodyIdx]?.raw ?? ''}
                  onChange={(e) => {
                    const bodies = [...step.request.bodies]
                    const activeIdx = step.request.activeBodyIdx
                    bodies[activeIdx] = { ...bodies[activeIdx], type: 'raw', raw: e.target.value }
                    updateRequest(step.id, { bodies })
                  }}
                  rows={4}
                  placeholder="request body"
                  className="p-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono resize-none outline-none"
                />
              )}
              {step.type === 'script' && (
                <textarea
                  value={step.script ?? ''}
                  onChange={(e) => updateStep(step.id, { script: e.target.value })}
                  rows={5}
                  placeholder={'return { token: vars["login.token"] }'}
                  className="p-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono resize-none outline-none"
                />
              )}
              <div className="flex items-center gap-3 text-[10px] text-text-4">
                <span>#{index + 1}</span>
                <span>{step.type}</span>
                {step.durationMs !== undefined && <span>{step.durationMs.toFixed(0)}ms</span>}
                {step.assertionsTotal !== undefined && <span>{step.assertionsPassed}/{step.assertionsTotal} assertions</span>}
                {step.error && <span className="text-error">{step.error}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside className="border-l border-border-1 flex flex-col min-h-0">
        <div className="p-3 border-b border-border-1">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen size={12} className="text-accent" />
            <h3 className="text-xs font-semibold text-text-2">Saved Flows</h3>
          </div>
          <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
            {sortedSavedFlows.map((flow) => (
              <div key={flow.id} className="flex items-center gap-1 rounded border border-border-1 bg-surface-1 px-2 py-1">
                <button onClick={() => loadFlow(flow)} className="flex-1 min-w-0 text-left text-[11px] text-text-2 truncate">{flow.name}</button>
                <button onClick={() => deleteFlow(flow.id)} className="text-text-4 hover:text-error" title="Delete"><Trash2 size={11} /></button>
              </div>
            ))}
            {sortedSavedFlows.length === 0 && <div className="text-[10px] text-text-4">Save this flow to reuse it later.</div>}
          </div>
        </div>
        <div className="p-3 border-b border-border-1 flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-text-2">Record to Mock</h3>
          <select value={recordMethod} onChange={(e) => setRecordMethod(e.target.value as HttpMethod)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1">
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
          <input value={recordUrl} onChange={(e) => setRecordUrl(e.target.value)} placeholder="real URL" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
          <input value={recordPath} onChange={(e) => setRecordPath(e.target.value)} placeholder="mock path, optional" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono" />
          <button onClick={recordToMock} disabled={!recordUrl || !port} className="px-3 py-1.5 bg-accent text-white rounded text-xs disabled:opacity-50">Record</button>
          {recordMessage && <div className="text-[10px] text-text-3">{recordMessage}</div>}
        </div>
        <div className="p-3 border-b border-border-1">
          <h3 className="text-xs font-semibold text-text-2 mb-2">Flow Variables</h3>
          <div className="max-h-56 overflow-y-auto text-[10px] font-mono">
            {Object.entries(vars).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[1fr_1fr] gap-2 py-0.5 border-b border-border-1/30">
                <span className="text-accent truncate">{k}</span>
                <span className="text-text-3 truncate">{v}</span>
              </div>
            ))}
            {Object.keys(vars).length === 0 && <div className="text-text-4">Run a flow to extract variables</div>}
          </div>
        </div>
        <div className="p-3 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-text-2">Last Run</h3>
            <button onClick={exportFlowMarkdown} disabled={lastRun.length === 0} className="text-text-4 hover:text-accent disabled:opacity-40" title="Export Markdown"><Download size={12} /></button>
          </div>
          <div className="overflow-y-auto max-h-full flex flex-col gap-1">
            {lastRun.map((entry) => (
              <div key={entry.stepId} className="rounded border border-border-1 bg-surface-1 px-2 py-1 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className={entry.status === 'ok' ? 'text-green-400' : 'text-error'}>{entry.status.toUpperCase()}</span>
                  <span className="text-text-2 truncate">{entry.stepName}</span>
                  <span className="ml-auto text-text-4">{entry.durationMs.toFixed(0)}ms</span>
                </div>
                {entry.assertions.length > 0 && (
                  <div className="text-text-4 mt-1">{entry.assertions.filter((a) => a.passed).length}/{entry.assertions.length} assertions</div>
                )}
                {entry.error && <div className="text-error mt-1">{entry.error}</div>}
              </div>
            ))}
            {lastRun.length === 0 && <div className="text-[10px] text-text-4">No run yet.</div>}
          </div>
        </div>
      </aside>
    </div>
  )
}
