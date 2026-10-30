import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/code-studio/studioChatContext', () => ({ prepareStudioChat: async (_root: string, message: string) => ({ message: `prepared ${message}`, labels: ['project', 'current.py (unsaved)'] }) }))
import { applyAgentChatEvent, createAgentChatStore, type AgentChatApi } from './agentChat'

describe('shared agent prompt transport', () => {
  it('sends images separately from project text and never stores image bytes in the transcript', async () => {
    const prompt = vi.fn<AgentChatApi['prompt']>(async () => ({ token: 'ok', messageId: 'm' }))
    const store = createAgentChatStore({ prompt } as unknown as AgentChatApi)
    const result = await store.getState().sendChat('/project', 'Explain', { includeDocument: true, includeWorkspace: true, attachments: [{ name: 'shot.png', mimeType: 'image/png', kind: 'image', data: 'PRIVATE_IMAGE_BYTES' }] })
    expect(result).toBe(true)
    expect(prompt.mock.calls[0][0]).toMatchObject({ root: '/project', message: 'prepared Explain', images: [{ name: 'shot.png', mimeType: 'image/png', data: 'PRIVATE_IMAGE_BYTES' }] })
    const transcript = store.getState().chatThreads['/project']
    expect(transcript.messages[0].context).toContain('current.py (unsaved)')
    expect(JSON.stringify(transcript)).not.toContain('PRIVATE_IMAGE_BYTES')
  })
  it('returns failure so the composer can retain its draft and attachments', async () => {
    const store = createAgentChatStore({ prompt: async () => { throw new Error('agent offline') } } as unknown as AgentChatApi)
    expect(await store.getState().sendChat('/project', 'Explain')).toBe(false)
    expect(store.getState().chatThreads['/project'].error).toBe('agent offline')
    expect(store.getState().chatThreads['/project'].busyToken).toBeNull()
  })
  it('keeps scoped task events out of provider chats', () => {
    const threads = {}
    expect(applyAgentChatEvent(threads, { token: 'attempt-one', root: '/project', sessionKey: 'attempt-one', kind: 'begin' })).toBe(threads)
  })
})
