import { describe, expect, it } from 'vitest'
import { localEndpoint, parseLocalStream } from './localLlm'

function stream(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close() } })
}
describe('local model transport', () => {
  it('accepts only local HTTP endpoints', () => {
    expect(localEndpoint('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1')
    expect(localEndpoint('http://[::1]:1234/v1')).toContain('[::1]')
    for (const endpoint of ['https://example.com/v1', 'http://localhost.evil/v1', 'http://u:p@localhost/v1', 'file:///tmp/llm']) expect(() => localEndpoint(endpoint)).toThrow()
  })
  it('decodes split UTF-8, CRLF and streamed function arguments', async () => {
    const text = 'data: {"choices":[{"delta":{"content":"Caffè ☕"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_project_file","arguments":"{\\\"path\\\":"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"main.go\\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'
    const chunks: string[] = []
    const result = await parseLocalStream(stream(text), value => chunks.push(value))
    expect(result.text).toBe('Caffè ☕')
    expect(chunks).toEqual(['Caffè ☕'])
    expect(result.calls[0].function).toEqual({ name: 'read_project_file', arguments: '{"path":"main.go"}' })
  })
  it('reports a truncated stream and token exhaustion', async () => {
    await expect(parseLocalStream(stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), () => {})).rejects.toThrow('before completion')
    await expect(parseLocalStream(stream('data: {"choices":[{"finish_reason":"length"}]}\n\n'), () => {})).rejects.toThrow('output limit')
  })
  it('stops at DONE without waiting for the server to close the connection', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')) }, cancel() { cancelled = true } })
    await expect(parseLocalStream(body, () => {})).resolves.toEqual({ text: '', calls: [] })
    expect(cancelled).toBe(true)
  })
})
