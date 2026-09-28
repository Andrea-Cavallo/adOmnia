import { blankKVRow, blankRequest, type Collection, type HttpMethod, type RequestItem, type TreeNode } from '@/lib/types'
import { capabilityMapForPrompt, relevantCapabilities } from '@/lib/aiCapabilities'
import { normalizeRailItem, type RailItem } from '@/lib/navigation'
export { isAICompanionAvailable } from './aiAvailability'

export type CompanionMood = 'happy' | 'thinking' | 'concerned'

export const COMPANION_WELCOME = 'Hi — what would you like to work on?'

export interface HeaderSuggestion {
  key: string
  value: string
  reason?: string
}

export interface CreateRequestAction {
  type: 'create-request'
  name: string
  method: HttpMethod
  url: string
  headers: HeaderSuggestion[]
  body?: string
}

export interface GenerateMockAction {
  type: 'generate-mock'
  description: string
}

export interface OpenPanelAction {
  type: 'open-panel'
  panel: RailItem
}

export interface CompanionHistoryMessage {
  role: 'assistant' | 'user'
  text: string
}

export type CompanionWorkspaceAction = CreateRequestAction | GenerateMockAction

export interface CompanionReply {
  reply: string
  mood: CompanionMood
  headerSuggestions: HeaderSuggestion[]
  actions: Array<'open-flow' | 'open-docs'>
  navigationActions: OpenPanelAction[]
  workspaceActions: CompanionWorkspaceAction[]
}

function unwrapJSON(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function safeHeaders(value: unknown): HeaderSuggestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const key = typeof candidate.key === 'string' ? candidate.key.trim() : ''
    const headerValue = typeof candidate.value === 'string' ? candidate.value.trim() : ''
    if (!key || !headerValue || /[\r\n:]/.test(key) || /[\r\n]/.test(headerValue)) return []
    return [{ key: key.slice(0, 128), value: headerValue.slice(0, 2048), reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 240) : undefined }]
  }).slice(0, 8)
}

const HTTP_METHODS = new Set<HttpMethod>(['GET', 'QUERY', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'WS', 'SOAP'])

function safeRequestURL(value: unknown): string {
  if (typeof value !== 'string') return ''
  const url = value.trim().slice(0, 4096)
  if (!url || /[\r\n]/.test(url)) return ''
  if (url.includes('{{')) return url
  return /^(?:https?|wss?):\/\//i.test(url) ? url : ''
}

function safeWorkspaceActions(value: unknown): CompanionWorkspaceAction[] {
  if (!Array.isArray(value)) return []
  return value.reduce<CompanionWorkspaceAction[]>((actions, item) => {
    if (!item || typeof item !== 'object' || actions.length >= 3) return actions
    const candidate = item as Record<string, unknown>
    if (candidate.type === 'generate-mock') {
      const description = typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 8_000) : ''
      if (description) actions.push({ type: 'generate-mock', description })
      return actions
    }
    if (candidate.type !== 'create-request') return actions
    const method = typeof candidate.method === 'string' ? candidate.method.toUpperCase() as HttpMethod : 'GET'
    const url = safeRequestURL(candidate.url)
    if (!HTTP_METHODS.has(method) || !url) return actions
    const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const name = rawName.replace(/[\r\n\t]+/g, ' ').slice(0, 120) || `${method} request`
    const body = typeof candidate.body === 'string' ? candidate.body.slice(0, 1_000_000) : undefined
    actions.push({ type: 'create-request', name, method, url, headers: safeHeaders(candidate.headers), body })
    return actions
  }, [])
}

function safeNavigationActions(value: unknown): OpenPanelAction[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (candidate.type !== 'open-panel') return []
    const panel = normalizeRailItem(candidate.panel)
    return panel ? [{ type: 'open-panel' as const, panel }] : []
  }).slice(0, 3)
}

export function materializeCompanionRequest(action: CreateRequestAction): RequestItem {
  const request = blankRequest(action.method, action.name)
  request.url = action.url
  request.headers = action.headers.length
    ? action.headers.map((header) => ({ ...blankKVRow(), key: header.key, value: header.value, enabled: true }))
    : request.headers
  if (action.body !== undefined && !['GET', 'HEAD'].includes(action.method)) {
    request.bodies[0] = { ...request.bodies[0], type: 'raw', raw: action.body, lang: 'json' }
  }
  return request
}

/** Fast, deterministic handling for the common root greeting-request command.
 * The model still handles arbitrary request designs through workspaceActions,
 * but this exact intent must work even when a provider ignores the JSON schema. */
export function inferCompanionRequestAction(value: string): CreateRequestAction | null {
  const text = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:non|not|don\s*t|do not|never)\b.{0,40}\b(?:crea|creare|create|add)\b/.test(text)) return null
  const asksToCreate = /\b(?:crea|creami|creare|aggiungi|nuov[ao]|create|add|new)\b/.test(text)
  const describesRequest = /\b(?:api|endpoint|request|richiesta)\b/.test(text)
  const asksForRoot = /(?:fuori|outside).{0,20}(?:collection|collezion)|(?:workspace\s+root|root\s+level|livello\s+root)/.test(text)
  const isGreeting = /\b(?:saluta|saluto|ciao|hello|greeting|greet)\b/.test(text)
  if (!asksToCreate || !describesRequest || !asksForRoot || !isGreeting) return null
  const explicitURL = value.match(/https?:\/\/[^\s)\]}]+/i)?.[0]
  return {
    type: 'create-request',
    name: 'Greeting API',
    method: 'GET',
    url: explicitURL ?? 'http://127.0.0.1:3000/hello',
    headers: [{ key: 'Accept', value: 'application/json' }],
  }
}

/** Deterministic fast path for the most common cross-product command. */
export function inferMockGenerationAction(value: string): GenerateMockAction | null {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:non|not|don\s*t|do not|never)\b.{0,40}\b(?:mock|simul|stub)/.test(normalized)) return null

  const italian = value.match(/\b(?:mockami|mocka|mockare|simula|simulami)\b\s+(.+)/i)
  if (italian?.[1]?.trim()) return { type: 'generate-mock', description: italian[1].trim().replace(/[.!?]+$/, '') }

  const englishFor = value.match(/\b(?:create|make|generate|build)\s+(?:me\s+)?(?:a\s+)?mock\s+(?:api|server|endpoints?)\s+(?:for|of)\s+(.+)/i)
  if (englishFor?.[1]?.trim()) return { type: 'generate-mock', description: englishFor[1].trim().replace(/[.!?]+$/, '') }

  const english = value.match(/\b(?:create|make|generate|build)\s+(?:me\s+)?(?:a\s+)?mock\s+(.+)/i)
  return english?.[1]?.trim() ? { type: 'generate-mock', description: english[1].trim().replace(/[.!?]+$/, '') } : null
}

export function parseCompanionReply(raw: string): CompanionReply {
  try {
    const parsed = JSON.parse(unwrapJSON(raw)) as Record<string, unknown>
    const mood: CompanionMood = parsed.mood === 'thinking' || parsed.mood === 'concerned' ? parsed.mood : 'happy'
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.filter((action): action is 'open-flow' | 'open-docs' => action === 'open-flow' || action === 'open-docs')
      : []
    return {
      reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : 'I need a little more detail before I can help.',
      mood,
      headerSuggestions: safeHeaders(parsed.headerSuggestions),
      actions: [...new Set(actions)],
      navigationActions: safeNavigationActions(parsed.navigationActions),
      workspaceActions: safeWorkspaceActions(parsed.workspaceActions),
    }
  } catch {
    return { reply: raw.trim() || 'I could not read that response. Please try again.', mood: 'concerned', headerSuggestions: [], actions: [], navigationActions: [], workspaceActions: [] }
  }
}

function requestOutline(nodes: TreeNode[], output: string[], prefix = '') {
  for (const node of nodes) {
    if (node.type === 'folder') {
      requestOutline(node.children, output, `${prefix}${node.name}/`)
    } else if (output.length < 60) {
      output.push(`${prefix}${node.name}: ${node.method} ${node.url || '(no URL)'}`)
    }
  }
}

export function buildCompanionPrompt(message: string, collections: Collection[], activeRequest?: RequestItem, workspaceActionsEnabled = false, history: CompanionHistoryMessage[] = []): { system: string; user: string } {
  const outline: string[] = []
  collections.forEach((collection) => requestOutline(collection.children, outline, `${collection.name}/`))
  const activeContext = activeRequest
    ? `\nActive request (shared because the user opened this assistant):\n${activeRequest.method} ${activeRequest.url || '(no URL)'}\nName: ${activeRequest.name}\nKnown header names: ${activeRequest.headers.filter((header) => header.key.trim()).map((header) => header.key).join(', ') || '(none)'}`
    : ''
  const recentHistory = history
    .filter((item) => item.text.trim())
    .slice(-8)
    .map((item) => `${item.role === 'user' ? 'User' : 'a0'}: ${item.text.trim().slice(0, 2_000)}`)
    .join('\n')
  const relevant = relevantCapabilities(message)
    .map((capability) => `- ${capability.label} [panel=${capability.panel}]: ${capability.summary}`)
    .join('\n')
  return {
    system: [
      'You are a0, the friendly adOmnia desktop API assistant.',
      'Reply in the same language as the most recent user message. Be generic and never assume or invent the user’s name.',
      'Use the following capability map as the source of truth about what adOmnia can do. Never claim a capability outside this map:',
      capabilityMapForPrompt(),
      workspaceActionsEnabled
        ? 'Agent actions are enabled. For explicit mutation requests, use create-request or generate-mock. Do not merely explain which button the user should click.'
        : 'Agent actions are disabled. Do not return workspaceActions or claim that you changed the workspace; explain that Agent actions can be enabled in Settings → AI Engine.',
      'For an explicit request to open or switch to a feature, return an open-panel navigation action using an exact panel id from the capability map.',
      'Never request or expose credentials, tokens, cookie values, or secrets. Suggest placeholders such as {{API_TOKEN}} instead.',
      'Return only JSON: {"reply":"concise Markdown-free text","mood":"happy|thinking|concerned","headerSuggestions":[{"key":"Header-Name","value":"value or {{PLACEHOLDER}}","reason":"why"}],"actions":["open-flow"|"open-docs"],"navigationActions":[{"type":"open-panel","panel":"mock"}],"workspaceActions":[{"type":"create-request","name":"Request name","method":"GET","url":"http://127.0.0.1:3000/hello","headers":[],"body":"optional body"},{"type":"generate-mock","description":"API behavior and endpoints to generate"}]}.',
      'Only suggest headers when the user explicitly asks for them. Use actions only when the user explicitly asks for a flow or API documentation.',
      workspaceActionsEnabled
        ? 'Use workspaceActions only for an explicit mutation request. create-request saves at workspace root; generate-mock creates local endpoints in Mock Server. Keep the generate-mock description complete enough for a specialized generator.'
        : 'Return an empty workspaceActions array.',
    ].join('\n'),
    user: `${recentHistory ? `Recent conversation:\n${recentHistory}\n\n` : ''}User request:\n${message}\n\nRelevant adOmnia capabilities:\n${relevant}\n\nWorkspace API outline (method, URL and names only):\n${outline.join('\n') || '(no saved requests)' }${activeContext}`,
  }
}
