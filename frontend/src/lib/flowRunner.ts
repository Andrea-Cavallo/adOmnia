import { evaluateAssertions } from '@/lib/assertionEngine'
import { executeRequest, type ExecuteRequestResult } from '@/lib/executeRequest'
import { expectedStatusMatches } from '@/lib/flowMermaid'
import {
  type FlowCondition,
  type FlowEdgeBranch,
  type FlowGraphDefinition,
  type FlowNodeDefinition,
  type FlowRunStatus,
} from '@/lib/flowStorage'
import { blankRequest, type AssertionResult, type RequestItem, type ResponseData, uid } from '@/lib/types'

export type RuntimeByNode = Record<string, { status: FlowRunStatus; durationMs?: number; message?: string }>

export interface RunEntry {
  id: string
  nodeId: string
  nodeLabel: string
  status: FlowRunStatus
  durationMs: number
  httpStatus?: number
  request?: RequestItem
  response?: ResponseData
  assertions?: AssertionResult[]
  attempts?: number
  error?: string
}

interface FlowContext {
  vars: Record<string, string>
  response?: ResponseData
  responses: Record<string, ResponseData>
}

export interface RunApiFlowOptions {
  initialVars: Record<string, string>
  startNodeId?: string
  execute?: (request: RequestItem, vars: Record<string, string>, options?: { signal?: AbortSignal }) => Promise<ExecuteRequestResult>
  signal?: AbortSignal
  onRuntime?: (runtime: RuntimeByNode) => void
  onEntry?: (entries: RunEntry[]) => void
  onVars?: (vars: Record<string, string>) => void
  onSelectedNode?: (nodeId: string) => void
}

export interface RunApiFlowResult {
  entries: RunEntry[]
  runtime: RuntimeByNode
  vars: Record<string, string>
}

function normalizeName(text: string) {
  return text.trim().replace(/\s+/g, '_').replace(/[^\w.-]/g, '').toLowerCase()
}

function nodeOverrideKey(node: FlowNodeDefinition) {
  return node.mermaidKey || normalizeName(node.label)
}

function safeJson(body: string): unknown {
  try { return JSON.parse(body) } catch { return undefined }
}

function getPath(source: unknown, path: string): unknown {
  if (!path) return source
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) => {
    if (value == null) return undefined
    if (Array.isArray(value)) return value[Number(key)]
    if (typeof value === 'object') return (value as Record<string, unknown>)[key]
    return undefined
  }, source)
}

function stringifyValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function applyExtractions(
  node: FlowNodeDefinition,
  response: ResponseData,
  vars: Record<string, string>,
  responses: Record<string, ResponseData>,
) {
  const next = { ...vars }
  const extractionContext: FlowContext = { vars: next, response, responses }
  for (const mapping of node.config.extractions ?? []) {
    let value: unknown
    if (mapping.source === 'status') value = response.status
    else if (mapping.source === 'header') value = response.headers[mapping.path] ?? response.headers[mapping.path.toLowerCase()]
    else if (mapping.source === 'expression') value = resolveExpression(mapping.path, extractionContext)
    else value = getPath(safeJson(response.body), mapping.path)
    const resolved = stringifyValue(value)
    if (resolved !== '') next[mapping.name] = resolved
    else if (mapping.fallback !== undefined) next[mapping.name] = mapping.fallback
  }
  return next
}

function resolveExpression(path: string, ctx: FlowContext): unknown {
  const trimmed = path.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}')) return ctx.vars[trimmed.slice(2, -2).trim()]
  if (trimmed.startsWith('vars.')) return ctx.vars[trimmed.slice(5)]
  if (trimmed.startsWith('response.status')) return ctx.response?.status
  if (trimmed.startsWith('response.headers.')) return ctx.response?.headers?.[trimmed.slice(17)]
  if (trimmed.startsWith('response.body.')) return getPath(safeJson(ctx.response?.body ?? ''), trimmed.slice(14))
  const [nodeKey, ...rest] = trimmed.split('.')
  if (rest.length > 0 && ctx.responses[nodeKey]) {
    const response = ctx.responses[nodeKey]
    if (rest[0] === 'status') return response.status
    if (rest[0] === 'headers') return response.headers[rest.slice(1).join('.')]
    if (rest[0] === 'body') return getPath(safeJson(response.body), rest.slice(1).join('.'))
  }
  return ctx.vars[trimmed] ?? trimmed
}

export function evaluateFlowCondition(condition: FlowCondition | undefined, ctx: FlowContext) {
  if (!condition) return { passed: false, message: 'Condition is not configured.' }
  let actual: unknown
  if (condition.source === 'status') actual = ctx.response?.status
  else if (condition.source === 'header') actual = ctx.response?.headers?.[condition.path] ?? ctx.response?.headers?.[condition.path.toLowerCase()]
  else if (condition.source === 'body') actual = getPath(safeJson(ctx.response?.body ?? ''), condition.path)
  else if (condition.source === 'variable') actual = ctx.vars[condition.path]
  else actual = resolveExpression(condition.path, ctx)

  const actualText = stringifyValue(actual)
  switch (condition.operator) {
    case 'exists': return { passed: actualText !== '', message: actualText !== '' ? `${condition.path} exists` : `${condition.path} is missing` }
    case 'not_exists': return { passed: actualText === '', message: actualText === '' ? `${condition.path} is missing` : `${condition.path} exists` }
    case 'eq': return { passed: actualText === condition.value, message: `${actualText || '(empty)'} == ${condition.value}` }
    case 'neq': return { passed: actualText !== condition.value, message: `${actualText || '(empty)'} != ${condition.value}` }
    case 'contains': return { passed: actualText.includes(condition.value), message: `${actualText || '(empty)'} contains ${condition.value}` }
    case 'gt': return { passed: Number(actualText) > Number(condition.value), message: `${actualText || '(empty)'} > ${condition.value}` }
    case 'lt': return { passed: Number(actualText) < Number(condition.value), message: `${actualText || '(empty)'} < ${condition.value}` }
    case 'gte': return { passed: Number(actualText) >= Number(condition.value), message: `${actualText || '(empty)'} >= ${condition.value}` }
    case 'lte': return { passed: Number(actualText) <= Number(condition.value), message: `${actualText || '(empty)'} <= ${condition.value}` }
  }
}

export function nextFlowEdge(graph: FlowGraphDefinition, nodeId: string, branch: FlowEdgeBranch) {
  const preferred = graph.edges.find((edge) => edge.source === nodeId && edge.branch === branch)
  if (preferred) return preferred
  if (branch !== 'next') return graph.edges.find((edge) => edge.source === nodeId && edge.branch === 'next')
  return graph.edges.find((edge) => edge.source === nodeId)
}

export function validateFlowGraph(graph: FlowGraphDefinition) {
  const errors: string[] = []
  if (graph.nodes.length === 0) errors.push('Paste or import a Mermaid flow to generate steps.')
  const starts = graph.nodes.filter((node) => node.type === 'start')
  if (graph.nodes.length > 0 && starts.length > 1) errors.push('Only one Start node is supported.')
  graph.nodes.forEach((node) => {
    const outgoing = graph.edges.filter((edge) => edge.source === node.id)
    if (node.type === 'start' && outgoing.length === 0) errors.push(`${node.label} has no next step.`)
    if (node.type === 'request' && !node.config.request?.url.trim()) errors.push(`${node.label} is not connected to a request URL.`)
    if (node.type === 'condition' && !node.config.condition?.path.trim()) errors.push(`${node.label} has no condition response path.`)
    if (node.type === 'condition' && !outgoing.some((edge) => edge.branch === 'true')) errors.push(`${node.label} needs a true/yes branch.`)
    if (node.type === 'condition' && !outgoing.some((edge) => edge.branch === 'false' || edge.branch === 'else')) errors.push(`${node.label} needs a false/no branch.`)
  })
  return [...new Set(errors)]
}

function elapsed(started: number) {
  return performance.now() - started
}

function waitForDelay(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve(!signal?.aborted)
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    const onAbort = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runApiFlow(graph: FlowGraphDefinition, options: RunApiFlowOptions): Promise<RunApiFlowResult> {
  const execute = options.execute ?? executeRequest
  const entries: RunEntry[] = []
  const runtime: RuntimeByNode = Object.fromEntries(graph.nodes.map((node) => [node.id, { status: 'idle' as FlowRunStatus }]))
  let ctx: FlowContext = { vars: { ...options.initialVars }, responses: {} }
  let current = (options.startNodeId ? graph.nodes.find((node) => node.id === options.startNodeId) : undefined)
    ?? graph.nodes.find((node) => node.type === 'start')
    ?? graph.nodes.find((node) => node.type !== 'end')
  let steps = 0

  const publishRuntime = () => options.onRuntime?.({ ...runtime })
  const setNodeStatus = (id: string, patch: RuntimeByNode[string]) => {
    runtime[id] = { ...runtime[id], ...patch }
    publishRuntime()
  }
  const pushEntry = (entry: RunEntry) => {
    entries.push(entry)
    options.onEntry?.([...entries])
  }
  const moveTo = (from: FlowNodeDefinition, branch: FlowEdgeBranch) => {
    const edge = nextFlowEdge(graph, from.id, branch)
    if (!edge) {
      if (from.type === 'request' && branch === 'success') {
        return undefined
      }
      if (graph.settings.stopOnMissingBranch) {
        pushEntry({
          id: uid(),
          nodeId: from.id,
          nodeLabel: from.label,
          status: 'failed',
          durationMs: 0,
          error: `No ${branch} branch is configured from ${from.label}.`,
        })
      }
      return undefined
    }
    return graph.nodes.find((node) => node.id === edge.target)
  }

  publishRuntime()
  while (current && steps < graph.settings.maxSteps) {
    if (options.signal?.aborted) {
      pushEntry({ id: uid(), nodeId: 'engine', nodeLabel: 'Execution stopped', status: 'skipped', durationMs: 0, error: 'Stopped by user.' })
      break
    }
    steps += 1
    options.onSelectedNode?.(current.id)
    setNodeStatus(current.id, { status: 'running' })
    const started = performance.now()
    const entryBase = { id: uid(), nodeId: current.id, nodeLabel: current.label }

    if (current.type === 'start') {
      const durationMs = elapsed(started)
      setNodeStatus(current.id, { status: 'success', durationMs, message: 'Started' })
      pushEntry({ ...entryBase, status: 'success', durationMs })
      current = moveTo(current, 'next')
      continue
    }

    if (current.type === 'end') {
      // A normal recorded flow ends in a node labelled “Stop”. The configured
      // end state, rather than a presentation label, is the execution contract.
      const failed = current.config.endState === 'failed'
      const durationMs = elapsed(started)
      setNodeStatus(current.id, { status: failed ? 'failed' : 'success', durationMs, message: current.label })
      pushEntry({ ...entryBase, status: failed ? 'failed' : 'success', durationMs, error: failed ? current.label : undefined })
      break
    }

    if (current.type === 'condition') {
      const result = evaluateFlowCondition(current.config.condition, ctx)
      const durationMs = elapsed(started)
      setNodeStatus(current.id, { status: result.passed ? 'success' : 'skipped', durationMs, message: result.message })
      pushEntry({ ...entryBase, status: result.passed ? 'success' : 'skipped', durationMs, error: result.passed ? undefined : result.message })
      current = moveTo(current, result.passed ? 'true' : 'false')
      continue
    }

    if (current.type !== 'request') break
    if (!await waitForDelay(Math.max(0, current.config.delayMs ?? 0), options.signal)) {
      const durationMs = elapsed(started)
      setNodeStatus(current.id, { status: 'skipped', durationMs, message: 'Stopped by user.' })
      pushEntry({ ...entryBase, status: 'skipped', durationMs, error: 'Stopped by user.' })
      break
    }
    const request = {
      ...(current.config.request ?? blankRequest()),
      timeout: current.config.timeoutMs && current.config.timeoutMs > 0 ? current.config.timeoutMs : current.config.request?.timeout,
    }
    const maxAttempts = Math.max(1, Math.min(10, (current.config.retryCount ?? 0) + 1))
    let execution: ExecuteRequestResult | null = null
    let response: ResponseData = {
      status: 0,
      statusText: '',
      headers: {},
      body: '',
      contentType: '',
      ms: 0,
      size: 0,
      error: { code: 'ERR', message: 'Request was not executed' },
    }
    let assertions: AssertionResult[] = []
    let failedAssertions: AssertionResult[] = []
    let expectedOk = false
    let failed = true

    let attempts = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt
      execution = await execute(request, ctx.vars, { signal: options.signal })
      response = execution.response
      assertions = evaluateAssertions(request.assertions, response)
      failedAssertions = assertions.filter((assertion) => !assertion.passed)
      expectedOk = expectedStatusMatches(current.config.expectedStatus ?? '2xx', response.status)
      failed = Boolean(response.error) || response.status >= 400 || !expectedOk || failedAssertions.length > 0
      if (!failed || attempt === maxAttempts) break
    }
    if (!execution) {
      execution = { response, vars: ctx.vars, mutations: {}, scriptRuns: [] }
    }
    const nodeKey = nodeOverrideKey(current) || current.id
    const responses = { ...ctx.responses, [nodeKey]: response }
    const extractedVars = applyExtractions(current, response, execution.vars, responses)
    ctx = { vars: { ...extractedVars, [`${nodeKey}.status`]: String(response.status) }, response, responses }
    options.onVars?.(ctx.vars)
    const durationMs = elapsed(started)
    const error = response.error?.message
      || (!expectedOk ? `Expected ${current.config.expectedStatus || '2xx'}, got HTTP ${response.status}` : undefined)
      || (failedAssertions.length > 0 ? `${failedAssertions.length} assertion failed` : undefined)
    setNodeStatus(current.id, { status: failed ? 'failed' : 'success', durationMs, message: failed ? error : `${response.status} ${response.statusText}` })
    pushEntry({ ...entryBase, status: failed ? 'failed' : 'success', durationMs, httpStatus: response.status, request, response, assertions, attempts, error })
    const stopOnFailure = current.config.stopOnFailure ?? graph.settings.failOnHttpError
    current = moveTo(current, failed && stopOnFailure ? 'error' : 'success')
  }

  if (steps >= graph.settings.maxSteps) {
    pushEntry({ id: uid(), nodeId: 'engine', nodeLabel: 'Execution limit', status: 'failed', durationMs: 0, error: `Stopped after ${graph.settings.maxSteps} steps.` })
  }
  graph.nodes.forEach((node) => {
    if (runtime[node.id]?.status === 'idle') runtime[node.id] = { status: 'skipped' }
  })
  publishRuntime()
  options.onVars?.(ctx.vars)
  return { entries, runtime: { ...runtime }, vars: ctx.vars }
}
