import { describe, expect, it } from 'vitest'
import { applyMilkChatEvent, type MilkChatThread } from './milk'

const thread = (): Record<string, MilkChatThread> => ({
  '/p': {
    busyToken: 't1',
    error: null,
    messages: [
      { id: 't1-user', role: 'user', content: 'hi' },
      { id: 't1-assistant', role: 'assistant', content: '' },
    ],
  },
})

describe('applyMilkChatEvent', () => {
  it('keeps reasoning apart from the answer', () => {
    let threads = applyMilkChatEvent(thread(), { token: 't1', root: '/p', kind: 'thought', reply: 'pondering' })
    threads = applyMilkChatEvent(threads, { token: 't1', root: '/p', kind: 'text', reply: 'answer' })
    const reply = threads['/p'].messages[1]
    expect(reply.thought).toBe('pondering')
    expect(reply.content).toBe('answer')
  })

  it('updates tools without mutating the previous state', () => {
    const first = applyMilkChatEvent(thread(), { token: 't1', root: '/p', kind: 'tool', tool: { toolCallId: 'a', name: 'bash', status: 'in_progress' } })
    const before = first['/p'].messages[1].tools![0]
    const second = applyMilkChatEvent(first, { token: 't1', root: '/p', kind: 'tool', tool: { toolCallId: 'a', name: '', status: 'completed' } })
    expect(before.status).toBe('in_progress')
    expect(second['/p'].messages[1].tools).toEqual([{ toolCallId: 'a', name: 'bash', status: 'completed', rawOutput: undefined }])
  })

  it('frees the thread when the turn ends', () => {
    const threads = applyMilkChatEvent(thread(), { token: 't1', root: '/p', kind: 'end', stopReason: 'end_turn' })
    expect(threads['/p'].busyToken).toBeNull()
  })
})

describe('ACP v1 partial tool updates', () => {
  it('keep name, status and output an update leaves empty', () => {
    let threads = applyMilkChatEvent(thread(), { token: 't1', root: '/p', kind: 'tool', tool: { toolCallId: 'a', name: 'Find', status: 'pending' } })
    threads = applyMilkChatEvent(threads, { token: 't1', root: '/p', kind: 'tool', tool: { toolCallId: 'a', name: '', status: '', rawOutput: 'a.txt' } })
    threads = applyMilkChatEvent(threads, { token: 't1', root: '/p', kind: 'tool', tool: { toolCallId: 'a', name: '', status: 'completed' } })
    expect(threads['/p'].messages[1].tools).toEqual([{ toolCallId: 'a', name: 'Find', status: 'completed', rawOutput: 'a.txt' }])
  })
})
