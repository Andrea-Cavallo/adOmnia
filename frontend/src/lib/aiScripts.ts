import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { useCollectionsStore } from '@/stores/collections'
import type { Collection, RequestItem, TreeNode } from '@/lib/types'

export type ScriptKind = 'pre' | 'post' | 'tests'

/**
 * An OpenAPI document can be far larger than the model's context window, and
 * paying to send an entire spec to write one script is wasteful. Send a slice
 * and say so, rather than silently truncating mid-token.
 */
const MAX_SPEC_CHARS = 12_000

const KIND_BRIEF: Record<ScriptKind, string> = {
  pre: 'a PRE-REQUEST script that prepares the call: compute or refresh values, set environment variables, build headers or signatures. It runs BEFORE the request is sent, so there is no response available.',
  post: 'a POST-RESPONSE script that processes the result: extract values from the response and store them in environment variables for later requests, and log anything useful. It runs AFTER the response arrives.',
  tests: 'a TEST script that asserts the response is correct: status code, response time, required fields, and types. Use pm.test() with pm.expect() assertions.',
}

const SYSTEM_PROMPT = `You write scripts for adOmnia, a local-first API client.

The scripting API is Postman-compatible \`pm.*\`:
  pm.environment.get(key) / pm.environment.set(key, value)
  pm.variables.get(key)
  pm.request.headers.add({ key, value })
  pm.response.json() / pm.response.text() / pm.response.code / pm.response.responseTime
  pm.test(name, fn) with pm.expect(value).to.* assertions

Rules:
- Output ONLY raw JavaScript. No markdown fences, no prose, no explanation.
- Use only the pm.* API above plus standard JavaScript. No imports, no require.
- Keep it short and readable. Comment only where the intent is not obvious.
- If the provided API details are insufficient, write the most reasonable
  script you can for the endpoint shown rather than emitting placeholders.`

function findCollectionForRequest(requestId: string): Collection | undefined {
  const walk = (nodes: TreeNode[]): boolean =>
    nodes.some((node) => (node.type === 'folder' ? walk(node.children) : node.id === requestId))
  return useCollectionsStore
    .getState()
    .collections.find((collection) => walk(collection.children))
}

/** The API spec for this request, when its collection was imported from one. */
export function findSpecForRequest(request: RequestItem): string | undefined {
  const spec = findCollectionForRequest(request.id)?._openapiSpec
  if (!spec) return undefined
  return spec.length > MAX_SPEC_CHARS ? `${spec.slice(0, MAX_SPEC_CHARS)}\n… (spec truncated)` : spec
}

function describeRequest(request: RequestItem): string {
  const lines = [
    `Method: ${request.method}`,
    `URL: ${request.url || '(not set)'}`,
  ]
  const headers = request.headers?.filter((h) => h.enabled !== false && h.key)
  if (headers?.length) {
    lines.push(`Headers:\n${headers.map((h) => `  ${h.key}: ${h.value}`).join('\n')}`)
  }
  const body = request.bodies?.[request.activeBodyIdx ?? 0]
  if (body && body.type !== 'none' && body.raw?.trim()) {
    lines.push(`Request body (${body.type}, ${body.lang}):\n${body.raw.slice(0, 2000)}`)
  }
  if (request._openapiPath) lines.push(`OpenAPI path: ${request._openapiPath}`)
  return lines.join('\n')
}

/** Strip a ```js fence if the model adds one despite being told not to. */
function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:[a-zA-Z]*)\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : text).trim()
}

export async function generateScript(kind: ScriptKind, request: RequestItem): Promise<string> {
  await ensureAIConfigured()

  const spec = findSpecForRequest(request)
  const userPrompt = [
    `Write ${KIND_BRIEF[kind]}`,
    '',
    'The request:',
    describeRequest(request),
    spec ? `\nThe API specification for this collection:\n${spec}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await AIEngine.Complete(SYSTEM_PROMPT, userPrompt, 1200)
  const script = stripCodeFence(raw)
  if (!script) throw new Error('The model returned an empty script.')
  return script
}
