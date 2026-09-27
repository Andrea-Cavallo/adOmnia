import { blankKVRow, blankRequest, type Collection, type HttpMethod, type RequestItem, type TreeNode } from '@/lib/types'
import type { AppSettings } from '@/stores/settings'

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

export interface CompanionReply {
  reply: string
  mood: CompanionMood
  headerSuggestions: HeaderSuggestion[]
  actions: Array<'open-flow' | 'open-docs'>
  workspaceActions: CreateRequestAction[]
}

/** a0 is available only for a provider/model pair the user has explicitly tested. */
export function isAICompanionAvailable(ai: Pick<AppSettings['ai'], 'enabled' | 'model' | 'provider' | 'connectionVerifiedAt' | 'connectionProvider' | 'connectionModel'>): boolean {
  return ai.enabled
    && Boolean(ai.model.trim())
    && Boolean(ai.connectionVerifiedAt)
    && ai.connectionProvider === ai.provider
    && ai.connectionModel === ai.model
}

/** Bug Hunt has one deliberate entrance: an explicit play request made to a0.
 * This stays local and deterministic, so opening the game never requires a
 * provider round-trip and ordinary mentions of the game do not trigger it. */
export function isBugHuntPlayIntent(value: string): boolean {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!text) return false
  const playWords = '(?:play|playing|giocare|giochiamo|gioca|gioco)'
  const negative = new RegExp(`\\b(?:non|not|don t|do not|never|no)\\b(?:\\s+\\w+){0,5}\\s+${playWords}\\b`)
  if (negative.test(text)) return false

  return [
    /\b(?:i want|i wanna|i would like|i d like|let s|can we|shall we)\s+(?:to\s+)?play\b/,
    /\b(?:can i|may i|let me)\s+play\b/,
    /\b(?:play|start|launch|open)\s+(?:the\s+)?(?:game|bug hunt)\b/,
    /\b(?:voglio|vorrei)\s+giocare\b/,
    /\b(?:posso|potrei)\s+giocare\b/,
    /\b(?:giochiamo|giocherei)\b/,
    /\b(?:fammi|lasciami)\s+giocare\b/,
    /\b(?:facciamo|iniziamo)\s+(?:una\s+)?(?:partita|gioco)\b/,
    /\b(?:avvia|apri|inizia|lancia)\s+(?:il\s+)?(?:gioco|bug hunt)\b/,
    /\bgioca(?:re)?\s+(?:a\s+)?bug hunt\b/,
  ].some((pattern) => pattern.test(text))
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

function safeWorkspaceActions(value: unknown): CreateRequestAction[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (candidate.type !== 'create-request') return []
    const method = typeof candidate.method === 'string' ? candidate.method.toUpperCase() as HttpMethod : 'GET'
    const url = safeRequestURL(candidate.url)
    if (!HTTP_METHODS.has(method) || !url) return []
    const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const name = rawName.replace(/[\r\n\t]+/g, ' ').slice(0, 120) || `${method} request`
    const body = typeof candidate.body === 'string' ? candidate.body.slice(0, 1_000_000) : undefined
    return [{ type: 'create-request' as const, name, method, url, headers: safeHeaders(candidate.headers), body }]
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
      workspaceActions: safeWorkspaceActions(parsed.workspaceActions),
    }
  } catch {
    return { reply: raw.trim() || 'I could not read that response. Please try again.', mood: 'concerned', headerSuggestions: [], actions: [], workspaceActions: [] }
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

export function buildCompanionPrompt(message: string, collections: Collection[], activeRequest?: RequestItem, workspaceActionsEnabled = false): { system: string; user: string } {
  const outline: string[] = []
  collections.forEach((collection) => requestOutline(collection.children, outline, `${collection.name}/`))
  const activeContext = activeRequest
    ? `\nActive request (shared because the user opened this assistant):\n${activeRequest.method} ${activeRequest.url || '(no URL)'}\nName: ${activeRequest.name}\nKnown header names: ${activeRequest.headers.filter((header) => header.key.trim()).map((header) => header.key).join(', ') || '(none)'}`
    : ''
  return {
    system: [
      'You are a0, the friendly adOmnia desktop API assistant.',
      'Always reply in English. Be generic and never assume or invent the user’s name.',
      workspaceActionsEnabled
        ? 'Agent actions are enabled. When the user explicitly asks to create a request outside collections, return one create-request workspace action. Do not merely explain which button the user should click.'
        : 'Agent actions are disabled. Do not return workspaceActions or claim that you changed the workspace; explain that Agent actions can be enabled in Settings → AI Engine.',
      'You may help design flows, explain APIs, improve OpenAPI documentation, and suggest headers.',
      'Never request or expose credentials, tokens, cookie values, or secrets. Suggest placeholders such as {{API_TOKEN}} instead.',
      'Return only JSON: {"reply":"concise Markdown-free text","mood":"happy|thinking|concerned","headerSuggestions":[{"key":"Header-Name","value":"value or {{PLACEHOLDER}}","reason":"why"}],"actions":["open-flow"|"open-docs"],"workspaceActions":[{"type":"create-request","name":"Request name","method":"GET","url":"http://127.0.0.1:3000/hello","headers":[],"body":"optional body"}]}.',
      'Only suggest headers when the user explicitly asks for them. Use actions only when the user explicitly asks for a flow or API documentation.',
      workspaceActionsEnabled
        ? 'Use workspaceActions only for an explicit mutation request. A create-request action is saved at workspace root, outside user collections, and opened automatically.'
        : 'Return an empty workspaceActions array.',
    ].join('\n'),
    user: `User request:\n${message}\n\nWorkspace API outline (method, URL and names only):\n${outline.join('\n') || '(no saved requests)' }${activeContext}`,
  }
}
