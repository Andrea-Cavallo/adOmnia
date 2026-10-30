import { getServerPort, serverUrl, sidecarFetch } from './useServerPort'

export interface LocalLlmConfig { endpoint: string; model: string; vision: boolean; tools: boolean }
export interface LocalToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface LocalMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null; tool_calls?: LocalToolCall[]; tool_call_id?: string }

export function localEndpoint(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !(url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname))) throw new Error('Use a loopback endpoint such as http://localhost:1234/v1')
  return url.toString().replace(/\/$/, '')
}

async function localRequest(config: LocalLlmConfig, payload: unknown, signal?: AbortSignal, models = false, apiKey = '') {
  const port = await getServerPort()
  if (!port) throw new Error('The desktop sidecar is not ready. Reopen the project and try again.')
  const response = await sidecarFetch(serverUrl(port, '/ai/local/chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ endpoint: localEndpoint(config.endpoint), apiKey, models, payload }) })
  if (!response.ok) throw new Error((await response.text()).slice(0, 4096))
  return response
}

export async function localModels(config: LocalLlmConfig, apiKey = '', signal?: AbortSignal): Promise<string[]> {
  const response = await localRequest(config, null, signal, true, apiKey)
  const data = await response.json() as { data?: Array<{ id: string }> }
  return (data.data ?? []).map(item => item.id).filter(Boolean)
}

export async function parseLocalStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<{ text: string; calls: LocalToolCall[] }> {
  const reader = body.getReader(), decoder = new TextDecoder()
  let pending = '', text = '', doneEvent = false, terminalEvent = false
  const calls = new Map<number, LocalToolCall>()
  const consume = (event: string) => {
    const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!data) return
    if (data === '[DONE]') { doneEvent = true; terminalEvent = true; return }
    const chunk = JSON.parse(data) as { error?: { message: string }; choices?: Array<{ finish_reason?: string; delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> }
    if (chunk.error) throw new Error(chunk.error.message)
    const choice = chunk.choices?.[0], delta = choice?.delta
    if (delta?.content) { text += delta.content; if (text.length > 256000) throw new Error('Response exceeds the local chat limit'); onText(text) }
    for (const part of delta?.tool_calls ?? []) {
      if (part.index < 0 || part.index > 7) throw new Error('Too many tool calls in one response')
      const call = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
      if (part.id) call.id += part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
      if (call.function.arguments.length > 128 * 1024) throw new Error('Tool arguments exceed the limit')
      calls.set(part.index, call)
    }
    if (choice?.finish_reason === 'length') throw new Error('The model reached its output limit. Ask for a smaller change.')
    if (choice?.finish_reason) doneEvent = true
  }
  try {
    while (true) {
      const chunk = await reader.read()
      pending = (pending + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n')
      if (pending.length > 2 * 1024 * 1024) throw new Error('Local stream event exceeds the limit')
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) >= 0) { consume(pending.slice(0, boundary)); pending = pending.slice(boundary + 2) }
      if (chunk.done || terminalEvent) break
    }
    if (pending.trim()) consume(pending)
    if (!doneEvent) throw new Error('The model stream ended before completion. The partial response is kept.')
    return { text, calls: [...calls.values()] }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export async function localCompletion(config: LocalLlmConfig, messages: LocalMessage[], tools: unknown[], signal: AbortSignal, onText: (text: string) => void, apiKey = '') {
  const response = await localRequest(config, { model: config.model, messages, stream: true, max_tokens: 4096, ...(tools.length ? { tools } : {}) }, signal, false, apiKey)
  if (!response.body) throw new Error('The local server returned no stream')
  return parseLocalStream(response.body, onText)
}

export const isOllamaEndpoint = (endpoint: string): boolean => { try { return new URL(endpoint).port === '11434' } catch { return false } }

async function ollamaRequest(action: 'start' | 'pull', endpoint: string, model = '', signal?: AbortSignal) {
  const port = await getServerPort()
  if (!port) throw new Error('The desktop sidecar is not ready. Reopen the project and try again.')
  const response = await sidecarFetch(serverUrl(port, `/ai/local/ollama/${action}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ endpoint: localEndpoint(endpoint), model }) })
  if (!response.ok) throw new Error((await response.text()).trim().slice(0, 4096))
  return response
}

/** Starts `ollama serve` in the background when it is not running. Resolves true when adOmnia started it. */
export async function ensureOllama(endpoint: string, signal?: AbortSignal): Promise<boolean> {
  const data = await (await ollamaRequest('start', endpoint, '', signal)).json() as { started?: boolean }
  return data.started === true
}

/** Downloads a model (`ollama pull`), reporting progress as a 0–100 percentage when Ollama knows the size. */
export async function pullOllamaModel(endpoint: string, model: string, onProgress: (status: string, percent?: number) => void, signal?: AbortSignal): Promise<void> {
  const response = await ollamaRequest('pull', endpoint, model, signal)
  if (!response.body) throw new Error('Ollama returned no progress stream')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = ''
  for (;;) {
    const { done, value } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const lines = pending.split('\n')
    pending = done ? '' : lines.pop() ?? ''
    for (const line of lines.filter(item => item.trim())) {
      const event = JSON.parse(line) as { status?: string; error?: string; total?: number; completed?: number }
      if (event.error) throw new Error(event.error)
      onProgress(event.status ?? '', event.total ? Math.trunc((event.completed ?? 0) * 100 / event.total) : undefined)
    }
    if (done) return
  }
}
