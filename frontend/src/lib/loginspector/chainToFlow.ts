// From an observed chain to a runnable Flow and to Mock Server fixtures.
//
// The log shows what happened, not why. A value appearing in step 2's request
// and in step 1's response *may* be a dependency — or two services may simply
// echo the same tenant id. This module proposes the mapping either way and
// labels it: `confirmed` when the field names line up on a distinctive value,
// `coincidence` when only the value matched. Only confirmed mappings become
// flow variables; the rest stay visible as notes so nothing is fabricated.

import { layoutFlow } from '@/lib/flowLayout'
import { DEFAULT_FLOW_SETTINGS, type FlowEdgeDefinition, type FlowNodeDefinition, type SavedFlowDefinition } from '@/lib/flowStorage'
import type { StoredMockEndpoint } from '@/lib/mockEndpointStore'
import { uid, type KVRow, type RequestItem } from '@/lib/types'
import type { AnalyzedRequest } from './analyze'
import { pairCallPayloads, type PairedCallPayload } from './calls'
import { canonicalKey, unwrapNestedJson } from './normalize'
import { requestDraftFromEvent } from './reproduce'
import type { LogEvent } from './types'

/** Below this length a shared value is too common to claim as a dependency. */
const DISTINCTIVE_LENGTH = 6

export interface ChainStep {
  id: string
  order: number
  eventId: number
  service: string
  method: string
  url: string
  status: number | null
  request: RequestItem
  missing: string[]
  requestBody: unknown | null
  responseBody: unknown | null
  responseHeaders: Record<string, string>
  /** Set when request and response rows were joined without a span identity. */
  inferredPairing: boolean
}

export type MappingConfidence = 'confirmed' | 'coincidence'

export interface ChainMapping {
  id: string
  variable: string
  fromStepId: string
  fromPath: string
  toStepId: string
  toPath: string
  value: string
  confidence: MappingConfidence
  reason: string
}

export interface ChainProposal {
  key: string
  steps: ChainStep[]
  mappings: ChainMapping[]
}

function scalarPaths(value: unknown, path = '$', out: Map<string, string> = new Map(), depth = 0): Map<string, string> {
  if (depth > 6 || out.size > 400) return out
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) {
    value.forEach((item, index) => scalarPaths(item, `${path}[${index}]`, out, depth + 1))
    return out
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      scalarPaths(child, `${path}.${key}`, out, depth + 1)
    }
    return out
  }
  out.set(path, String(value))
  return out
}

function leafOf(path: string): string {
  return path.replace(/\[\d+\]$/, '').split('.').pop() || ''
}

/** Distinctive enough that an exact match across services is worth reporting. */
function distinctive(value: string): boolean {
  if (value.length < DISTINCTIVE_LENGTH) return false
  if (/^(?:true|false|null)$/i.test(value)) return false
  // A bare number is the classic false positive: quantities, prices, counters.
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return false
  return true
}

function namesAlign(from: string, to: string): boolean {
  const a = canonicalKey(leafOf(from))
  const b = canonicalKey(leafOf(to))
  if (!a || !b) return false
  return a === b || a.endsWith(b) || b.endsWith(a)
}

function variableName(path: string, taken: Set<string>): string {
  const base = leafOf(path).replace(/[^A-Za-z0-9]/g, '') || 'value'
  let name = base
  let counter = 2
  while (taken.has(name)) name = `${base}${counter++}`
  taken.add(name)
  return name
}

function headerRecord(value: unknown): Record<string, string> {
  const unwrapped = unwrapNestedJson(value)
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return {}
  const headers: Record<string, string> = {}
  for (const [key, entry] of Object.entries(unwrapped as Record<string, unknown>)) {
    if (entry !== null && typeof entry !== 'object') headers[key] = String(entry)
  }
  return headers
}

function stepFor(events: LogEvent[], pair: PairedCallPayload, order: number): ChainStep | null {
  const event = pair.requestEvent ?? pair.responseEvent
  if (!event) return null
  const draft = requestDraftFromEvent(events, event)
  return {
    id: `step-${order}-${event.id}`,
    order,
    eventId: event.id,
    service: event.service,
    method: draft.request.method,
    url: draft.request.url,
    status: pair.status,
    request: draft.request,
    missing: draft.missing,
    requestBody: unwrapNestedJson(pair.requestBody),
    responseBody: unwrapNestedJson(pair.responseBody),
    responseHeaders: headerRecord(pair.responseHeaders),
    inferredPairing: pair.inferred,
  }
}

/** Propose the steps and the response → request mappings observed in one chain. */
export function buildChainProposal(events: LogEvent[], request: AnalyzedRequest): ChainProposal {
  const ids = new Set(request.eventIds)
  const chainEvents = events.filter((event) => ids.has(event.id))
  const steps = pairCallPayloads(chainEvents)
    .map((pair, index) => stepFor(chainEvents, pair, index))
    .filter((step): step is ChainStep => step !== null)

  const mappings: ChainMapping[] = []
  const taken = new Set<string>()
  // A value produced by two different earlier steps cannot identify one of them.
  const producers = new Map<string, number>()
  for (const step of steps) {
    for (const value of new Set(scalarPaths(step.responseBody).values())) {
      producers.set(value, (producers.get(value) ?? 0) + 1)
    }
  }

  for (let target = 1; target < steps.length; target++) {
    const consumed = scalarPaths(steps[target].requestBody)
    const urlValues = steps[target].url
    for (let source = 0; source < target; source++) {
      const produced = scalarPaths(steps[source].responseBody)
      for (const [fromPath, value] of produced) {
        if (!distinctive(value)) continue
        const hit = [...consumed].find(([, candidate]) => candidate === value)
        const inUrl = !hit && urlValues.includes(value)
        if (!hit && !inUrl) continue
        const toPath = hit ? hit[0] : 'url'
        const ambiguous = (producers.get(value) ?? 0) > 1
        const aligned = !inUrl && namesAlign(fromPath, toPath)
        const confidence: MappingConfidence = !ambiguous && (aligned || inUrl) ? 'confirmed' : 'coincidence'
        mappings.push({
          id: uid(),
          variable: variableName(fromPath, taken),
          fromStepId: steps[source].id,
          fromPath,
          toStepId: steps[target].id,
          toPath,
          value,
          confidence,
          reason: ambiguous
            ? 'the same value appears in more than one response — the producer is ambiguous'
            : inUrl
              ? 'the value is embedded in the next URL'
              : aligned
                ? `field names align (${leafOf(fromPath)} → ${leafOf(toPath)})`
                : 'only the value matched; the field names are unrelated',
        })
      }
    }
  }

  return { key: `${request.correlationKey}:${request.correlationId || request.traceId || request.requestId}`, steps, mappings }
}

function substitute(text: string, replacements: { value: string; variable: string }[]): string {
  return replacements.reduce((current, { value, variable }) => current.split(value).join(`{{${variable}}}`), text)
}

function templatedRequest(step: ChainStep, replacements: { value: string; variable: string }[]): RequestItem {
  if (!replacements.length) return step.request
  const rows = (list: KVRow[] | undefined): KVRow[] | undefined => list?.map((row) => ({ ...row, value: substitute(row.value, replacements) }))
  return {
    ...step.request,
    id: uid(),
    url: substitute(step.request.url, replacements),
    params: rows(step.request.params) ?? step.request.params,
    headers: rows(step.request.headers) ?? step.request.headers,
    bodies: step.request.bodies.map((body) => ({ ...body, raw: substitute(body.raw, replacements) })),
  }
}

/**
 * Build a flow that replays the observed sequence. Only confirmed mappings are
 * turned into extractions and `{{variables}}`; coincidences stay in the node
 * note so the user decides.
 */
export function chainProposalToFlow(proposal: ChainProposal, name: string): SavedFlowDefinition {
  const confirmed = proposal.mappings.filter((mapping) => mapping.confidence === 'confirmed')
  const nodes: FlowNodeDefinition[] = [
    { id: 'start', type: 'start', label: 'Start', x: 0, y: 0, config: {} },
  ]
  const edges: FlowEdgeDefinition[] = []
  let previous = 'start'

  proposal.steps.forEach((step, index) => {
    const incoming = confirmed.filter((mapping) => mapping.toStepId === step.id)
    const outgoing = confirmed.filter((mapping) => mapping.fromStepId === step.id)
    const uncertain = proposal.mappings.filter((mapping) => mapping.toStepId === step.id && mapping.confidence === 'coincidence')
    nodes.push({
      id: step.id,
      type: 'request',
      label: `${step.method} ${step.url || step.service || `step ${index + 1}`}`.slice(0, 60),
      x: 0,
      y: 0,
      config: {
        request: templatedRequest(step, incoming.map((mapping) => ({ value: mapping.value, variable: mapping.variable }))),
        expectedStatus: step.status !== null ? String(step.status) : '2xx',
        stopOnFailure: true,
        seq: index,
        extractions: outgoing.map((mapping) => ({
          id: uid(),
          name: mapping.variable,
          source: 'body' as const,
          path: mapping.fromPath.replace(/^\$\.?/, ''),
        })),
        note: [
          `Observed in the log (event ${step.eventId}${step.service ? `, ${step.service}` : ''}).`,
          step.inferredPairing ? 'Request and response rows were not joined by a span id.' : '',
          step.missing.length ? `Missing from the log: ${step.missing.join('; ')}.` : '',
          uncertain.length ? `Unconfirmed value matches: ${uncertain.map((mapping) => `${mapping.fromPath} → ${mapping.toPath} (${mapping.reason})`).join('; ')}.` : '',
        ].filter(Boolean).join(' '),
      },
    })
    edges.push({ id: uid(), source: previous, target: step.id, branch: 'next' })
    previous = step.id
  })

  nodes.push({ id: 'end', type: 'end', label: 'End', x: 0, y: 0, config: { endState: 'success' } })
  edges.push({ id: uid(), source: previous, target: 'end', branch: 'next' })

  return {
    id: uid(),
    name,
    graph: layoutFlow({ nodes, edges, settings: { ...DEFAULT_FLOW_SETTINGS, stopOnMissingBranch: false } }),
    updatedAt: new Date().toISOString(),
    version: 4,
    schemaVersion: 4,
  }
}

/** Turn the observed responses into Mock Server fixtures, payload included. */
export function chainProposalToMockEndpoints(proposal: ChainProposal): StoredMockEndpoint[] {
  return proposal.steps
    .filter((step) => step.responseBody !== null && step.url)
    .map((step) => {
      let path = step.url.replace(/^\{\{[^}]+\}\}/, '')
      try { path = new URL(step.url).pathname } catch { /* relative url: keep it */ }
      if (!path.startsWith('/')) path = `/${path}`
      const status = step.status ?? 200
      return {
        id: uid(),
        path,
        method: step.method,
        description: `Captured from log event ${step.eventId}${step.service ? ` (${step.service})` : ''}`,
        responses: [{
          id: uid(),
          name: `Observed ${status}`,
          status,
          headers: Object.keys(step.responseHeaders).length ? step.responseHeaders : { 'Content-Type': 'application/json' },
          body: typeof step.responseBody === 'string' ? step.responseBody : JSON.stringify(step.responseBody, null, 2),
          delayMs: 0,
          isActive: true,
        }],
        mode: 'first_active',
        enabled: true,
      }
    })
}
