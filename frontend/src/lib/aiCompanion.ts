import type { Collection, RequestItem, TreeNode } from '@/lib/types'

export type CompanionMood = 'happy' | 'thinking' | 'concerned'

export interface HeaderSuggestion {
  key: string
  value: string
  reason?: string
}

export interface CompanionReply {
  reply: string
  mood: CompanionMood
  headerSuggestions: HeaderSuggestion[]
  actions: Array<'open-flow' | 'open-docs'>
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
    }
  } catch {
    return { reply: raw.trim() || 'I could not read that response. Please try again.', mood: 'concerned', headerSuggestions: [], actions: [] }
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

export function buildCompanionPrompt(message: string, collections: Collection[], activeRequest?: RequestItem): { system: string; user: string } {
  const outline: string[] = []
  collections.forEach((collection) => requestOutline(collection.children, outline, `${collection.name}/`))
  const activeContext = activeRequest
    ? `\nActive request (shared because the user opened this assistant):\n${activeRequest.method} ${activeRequest.url || '(no URL)'}\nName: ${activeRequest.name}\nKnown header names: ${activeRequest.headers.filter((header) => header.key.trim()).map((header) => header.key).join(', ') || '(none)'}`
    : ''
  return {
    system: [
      'You are a0, the friendly adOmnia desktop API assistant.',
      'adOmnia is local-first. Never claim you performed an action. Explain proposed changes and require the user to click an explicit UI action before any mutation.',
      'You may help design flows, explain APIs, improve OpenAPI documentation, and suggest headers.',
      'Never request or expose credentials, tokens, cookie values, or secrets. Suggest placeholders such as {{API_TOKEN}} instead.',
      'Return only JSON: {"reply":"concise Markdown-free text","mood":"happy|thinking|concerned","headerSuggestions":[{"key":"Header-Name","value":"value or {{PLACEHOLDER}}","reason":"why"}],"actions":["open-flow"|"open-docs"]}.',
      'Only suggest headers when the user explicitly asks for them. Use actions only when the user explicitly asks for a flow or API documentation.',
    ].join('\n'),
    user: `User request:\n${message}\n\nWorkspace API outline (method, URL and names only):\n${outline.join('\n') || '(no saved requests)' }${activeContext}`,
  }
}
