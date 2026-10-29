import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoIDESession } from '@/lib/code-studio-api'
const fixture = vi.hoisted(() => ({ complete: vi.fn(), prepare: vi.fn(), tool: vi.fn(), storage: new Map<string, string>() }))
vi.mock('@/lib/localLlm', () => ({ localCompletion: fixture.complete }))
vi.mock('@/lib/code-studio/studioChatContext', () => ({ prepareStudioChat: fixture.prepare }))
vi.mock('@/lib/code-studio/localLlmTools', () => ({ executeLocalTool: fixture.tool, LOCAL_PROJECT_TOOLS: [{ type: 'function' }] }))
import { clearLocalChat, sendLocalChat, stopLocalChat, useLocalLlmChat } from './localLlmChat'
const session = { id: 's1', project: { realPath: '/project' } } as GoIDESession
const config = { endpoint: 'http://localhost:1234/v1', model: 'test', tools: true, vision: true }
const context = { includeDocument: true, includeWorkspace: false }
beforeEach(() => {
  fixture.storage.clear(); fixture.complete.mockReset(); fixture.tool.mockReset(); fixture.prepare.mockReset()
  vi.stubGlobal('localStorage', { getItem: (key: string) => fixture.storage.get(key) ?? null, setItem: (key: string, value: string) => fixture.storage.set(key, value), removeItem: (key: string) => fixture.storage.delete(key) })
  useLocalLlmChat.setState({ conversations: {} })
  fixture.prepare.mockResolvedValue({ message: 'prepared context', labels: ['main.go'] })
})
describe('local project conversation', () => {
  it('feeds tool results back to the model and keeps exact context receipts', async () => {
    fixture.complete.mockResolvedValueOnce({ text: '', calls: [{ id: 'c1', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"main.go"}' } }] }).mockImplementationOnce(async (_cfg, _messages, _tools, _signal, onText) => { onText('Answer'); return { text: 'Answer', calls: [] } })
    fixture.tool.mockResolvedValue('file content')
    await sendLocalChat(session, config, 'Explain', context)
    expect(fixture.complete.mock.calls[1][1]).toContainEqual({ role: 'tool', tool_call_id: 'c1', content: 'file content' })
    const conversation = useLocalLlmChat.getState().conversations['/project']
    expect(conversation.turns[0]).toMatchObject({ answer: 'Answer', sources: ['main.go'], tools: ['read_project_file'] })
    expect(conversation.busy).toBe(false)
  })
  it('stops an active response and preserves partial output', async () => {
    fixture.complete.mockImplementation(async (_cfg, _messages, _tools, signal, onText) => { onText('Partial'); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
    const running = sendLocalChat(session, config, 'Explain', context)
    await vi.waitFor(() => expect(fixture.complete).toHaveBeenCalledOnce())
    stopLocalChat('/project'); await running
    expect(useLocalLlmChat.getState().conversations['/project']).toMatchObject({ busy: false, error: 'Response stopped. Partial output is kept.', turns: [{ answer: 'Partial' }] })
  })
  it('sends image parts but never persists their bytes or reattaches them', async () => {
    fixture.complete.mockResolvedValue({ text: 'Image answer', calls: [] })
    await sendLocalChat(session, config, 'Describe', { ...context, attachments: [{ name: 'shot.png', kind: 'image', mimeType: 'image/png', data: 'IMAGE_BYTES' }] })
    expect(fixture.complete.mock.calls[0][1][1].content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,IMAGE_BYTES' } })
    expect(JSON.stringify([...fixture.storage.values()])).not.toContain('IMAGE_BYTES')
    expect(JSON.stringify(useLocalLlmChat.getState().conversations['/project'].exchanges)).not.toContain('IMAGE_BYTES')
    clearLocalChat('/project')
    expect(fixture.storage.size).toBe(0)
  })
  it('does not send anything when project context preparation rejects access', async () => {
    fixture.prepare.mockRejectedValue(new Error('AI is turned off'))
    await sendLocalChat(session, config, 'Explain', context)
    expect(fixture.complete).not.toHaveBeenCalled()
    expect(useLocalLlmChat.getState().conversations['/project'].error).toBe('AI is turned off')
  })
})
