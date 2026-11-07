import { evaluateAssertions } from '@/lib/assertionEngine'
import { executeRequest } from '@/lib/executeRequest'
import type { AssertionResult, ResponseData } from '@/lib/types'
import { useAppStore } from '@/stores/app'
import { useDebugScenariosStore } from '@/stores/debugScenarios'
import { useDevSessionStore } from '@/stores/devSession'
import { runForTab } from '@/stores/devSessionModel'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'
import { buildEvidence, rowsDigest, scenarioBreakpoints, scenarioVars, type DebugScenario, type QueryEvidence, type ScenarioEvidence, type ScenarioQuery } from './debugScenario'
import { prepareDebugRequest } from './debugRequest'
import { finishLiveSend, prepareLiveSend } from './liveRequest'

/** Logs and SQL of a run reach the store a moment after the response. */
const EVIDENCE_SETTLE_MS = 700

function assertionsOf(request: DebugScenario['request'], response: ResponseData): AssertionResult[] {
  const scriptTests = (response.scripts?.runs ?? []).flatMap((run) => run.tests ?? []).map((test, index) => ({
    assertionId: `script-${index}`, label: `Test: ${test.name}`, passed: test.passed, actual: test.error ?? (test.passed ? 'passed' : 'failed'), expected: 'passed',
  }))
  return [...evaluateAssertions(request.assertions, response), ...scriptTests]
}

/** Read-only check queries on Database Studio connections; a failure is evidence, not an abort. */
async function runCheckQueries(queries: ScenarioQuery[], vars: Record<string, string>): Promise<QueryEvidence[]> {
  if (!queries.length) return []
  const { sidecarPost } = await import('@/components/code-studio/codeStudioAILiveContext')
  const results: QueryEvidence[] = []
  for (const query of queries) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one statement at a time, in the saved order
      const result = await sidecarPost<{ rows?: Array<Record<string, unknown>> }>('/database/query', {
        connectionId: query.connectionId, variables: vars, query: query.sql, limit: 200, timeoutMs: 5000, explain: false, confirm: false,
      })
      const rows = result.rows ?? []
      results.push({ sql: query.sql, rows: rows.length, digest: rowsDigest(rows) })
    } catch (error) {
      results.push({ sql: query.sql, rows: 0, digest: '', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

function evidenceFor(runId: string | null, service: string, scenario: Pick<DebugScenario, 'request'>, response: ResponseData, queries: QueryEvidence[]): ScenarioEvidence {
  const state = useDevSessionStore.getState()
  const run = runId ? state.runs[runId] : undefined
  return buildEvidence({
    at: new Date().toISOString(),
    service,
    response,
    assertions: assertionsOf(scenario.request, response),
    hits: run?.hits ?? [],
    logs: runId ? Object.values(state.logs).flat().filter((entry) => entry.requestRunId === runId) : [],
    sqlStatements: runId ? state.queries.filter((query) => query.requestRunId === runId) : [],
    messages: runId ? state.messages.filter((message) => message.requestRunId === runId) : [],
    queries,
  })
}

async function applyBreakpoints(goSessionId: string, scenario: DebugScenario): Promise<void> {
  if (!scenario.breakpoints.length) return
  const { useCodeStudioDebugStore } = await import('@/stores/codeStudioDebug')
  const debug = useCodeStudioDebugStore.getState()
  await debug.loadBreakpoints(goSessionId)
  for (const { relativePath, ...breakpoint } of scenario.breakpoints) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each call rewrites the file's breakpoint list
    await debug.putBreakpoint(goSessionId, relativePath, breakpoint)
  }
}

/**
 * One click: open the request, switch to the saved environment, start (or reuse) the service under
 * the debugger, set the saved breakpoints, send with the test data, then collect the evidence and
 * compare it with the previous run.
 */
export async function runDebugScenario(id: string): Promise<void> {
  const store = useDebugScenariosStore.getState()
  const scenario = store.scenarios.find((item) => item.id === id)
  if (!scenario || store.runs[id]?.done === false) return
  const progress = (message: string) => useDebugScenariosStore.getState().setRun(id, { message, done: false })
  const tabs = useTabsStore.getState()
  tabs.openTab(scenario.request, scenario.collectionId)
  const tabId = useTabsStore.getState().activeTabId
  if (!tabId) return
  useAppStore.getState().setActiveRail('collections')
  const environments = useEnvironmentsStore.getState()
  if (scenario.environmentId && environments.environments.some((env) => env.id === scenario.environmentId) && environments.activeEnvId !== scenario.environmentId) {
    environments.setActiveEnv(scenario.environmentId)
  }
  const vars = scenarioVars(useEnvironmentsStore.getState().getResolvedVars(), scenario.testData)
  try {
    progress('Starting the service under the debugger…')
    const prepared = await prepareDebugRequest(tabId, scenario.request, vars)
    useDevSessionStore.getState().setProgress(tabId, null)
    if (prepared.session.goSessionId) {
      progress('Setting breakpoints…')
      await applyBreakpoints(prepared.session.goSessionId, scenario)
    }
    progress(`Sending to ${prepared.session.service}…`)
    const live = await prepareLiveSend(tabId, prepared.request, vars, prepared.session.id)
    useTabsStore.getState().setLoading(tabId, true)
    // Environment mutations are not written back: a scenario replays, it does not change the environment.
    const result = await executeRequest(live.request, live.vars, { record: false })
    await finishLiveSend(live, result.response)
    useTabsStore.getState().setResponse(tabId, result.response)
    progress('Collecting evidence…')
    await new Promise((resolve) => setTimeout(resolve, EVIDENCE_SETTLE_MS))
    const queries = await runCheckQueries(scenario.queries, vars)
    useDebugScenariosStore.getState().recordRun(id, evidenceFor(live.runId, prepared.session.service, scenario, result.response, queries))
    useDebugScenariosStore.getState().setRun(id, { message: 'Done', done: true })
  } catch (error) {
    useTabsStore.getState().setLoading(tabId, false)
    useDebugScenariosStore.getState().setRun(id, { message: 'Failed', error: error instanceof Error ? error.message : String(error), done: true })
  }
}

/**
 * Saves the request of a tab as a scenario: its environment, the breakpoints of the service's project
 * and, when the tab already ran under the debugger, that run as the baseline to compare with.
 */
export async function saveScenarioFromTab(tabId: string, name: string): Promise<DebugScenario | null> {
  const tab = useTabsStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) return null
  const live = useDevSessionStore.getState()
  const run = runForTab(live, tabId)
  const session = run ? live.sessions[run.sessionId] : undefined
  let breakpoints: DebugScenario['breakpoints'] = []
  if (session?.goSessionId) {
    const { useCodeStudioDebugStore } = await import('@/stores/codeStudioDebug')
    await useCodeStudioDebugStore.getState().loadBreakpoints(session.goSessionId)
    breakpoints = scenarioBreakpoints(useCodeStudioDebugStore.getState().breakpoints[session.goSessionId])
  }
  const now = new Date().toISOString()
  const scenario: DebugScenario = {
    id: crypto.randomUUID(),
    name: name.trim() || tab.request.name || `${tab.request.method} ${tab.request.url}`,
    createdAt: now,
    updatedAt: now,
    request: structuredClone(tab.request),
    ...(tab.collectionId ? { collectionId: tab.collectionId } : {}),
    environmentId: useEnvironmentsStore.getState().activeEnvId,
    testData: [],
    breakpoints,
    queries: [],
    ...(run && tab.response && session ? { lastRun: evidenceFor(run.id, session.service, { request: tab.request }, tab.response, []) } : {}),
  }
  useDebugScenariosStore.getState().add(scenario)
  return scenario
}
