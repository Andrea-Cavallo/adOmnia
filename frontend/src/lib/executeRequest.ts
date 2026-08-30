import type { RequestItem, ResponseData, ScriptRunResult } from '@/lib/types'
import { sendRequest } from '@/lib/sendRequest'
import { runRequestScript } from '@/lib/scriptRuntime'
import { useFlowRecorderStore } from '@/stores/flowRecorder'

export interface ExecuteRequestResult {
  response: ResponseData
  vars: Record<string, string>
  mutations: Record<string, string | null>
  scriptRuns: ScriptRunResult[]
}

export async function executeRequest(
  request: RequestItem,
  vars: Record<string, string>,
  opts?: { signal?: AbortSignal; recordingEnvironment?: { id: string; name: string } | null },
): Promise<ExecuteRequestResult> {
  const nextVars = { ...vars }
  const mutations: Record<string, string | null> = {}
  const scriptRuns: ScriptRunResult[] = []
  // Recording observes this shared request pipeline, so Composer, API Docs and
  // future callers cannot accidentally implement a divergent capture path.
  const record = (response: ResponseData) => useFlowRecorderStore.getState().capture(request, opts?.recordingEnvironment ?? null, response)

  const applyMutations = (next: Record<string, string | null>) => {
    for (const [key, value] of Object.entries(next)) {
      mutations[key] = value
      if (value === null) delete nextVars[key]
      else nextVars[key] = value
    }
  }

  const pre = await runRequestScript(request.scripts?.pre, { request, vars: nextVars, phase: 'pre' })
  if (pre) {
    applyMutations(pre.mutations)
    scriptRuns.push(stripMutations(pre))
    if (!pre.passed) {
      const response = withScriptResults(errResp('SCRIPT_ERR', pre.error || 'Pre-request script failed'), scriptRuns, mutations)
      record(response)
      return { response, vars: nextVars, mutations, scriptRuns }
    }
  }

  const response = await sendRequest(request, nextVars, opts)

  const post = await runRequestScript(request.scripts?.post, { request, vars: nextVars, response, phase: 'post' })
  if (post) {
    applyMutations(post.mutations)
    scriptRuns.push(stripMutations(post))
  }

  const tests = await runRequestScript(request.scripts?.tests, { request, vars: nextVars, response, phase: 'tests' })
  if (tests) {
    applyMutations(tests.mutations)
    scriptRuns.push(stripMutations(tests))
  }

  const completedResponse = withScriptResults(response, scriptRuns, mutations)
  record(completedResponse)
  return {
    response: completedResponse,
    vars: nextVars,
    mutations,
    scriptRuns,
  }
}

function stripMutations(result: Awaited<ReturnType<typeof runRequestScript>>): ScriptRunResult {
  if (!result) {
    return { phase: 'tests', passed: true, durationMs: 0, tests: [], logs: [] }
  }
  const { mutations: _mutations, ...run } = result
  return run
}

function withScriptResults(
  response: ResponseData,
  scriptRuns: ScriptRunResult[],
  mutations: Record<string, string | null>,
): ResponseData {
  if (scriptRuns.length === 0 && Object.keys(mutations).length === 0) return response
  return { ...response, scripts: { runs: scriptRuns, mutations } }
}

function errResp(code: string, message: string, ms = 0): ResponseData {
  return { status: 0, statusText: '', headers: {}, body: '', contentType: '', ms, size: 0, error: { code, message } }
}
