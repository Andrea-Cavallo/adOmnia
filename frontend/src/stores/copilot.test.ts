import { describe, expect, it } from 'vitest'
import { applyCopilotChatEvent, type CopilotChatThread } from './copilot'

function thread(): CopilotChatThread {
  return {
    conversationId: '', turnId: '', title: '', busyToken: 'token-1', error: null,
    messages: [
      { id: 'token-1-user', role: 'user', content: 'Explain' },
      { id: 'token-1-assistant', role: 'assistant', content: '' },
    ],
  }
}

describe('Copilot chat streaming', () => {
  it('appends report chunks then completes the matching project thread', () => {
    const first = applyCopilotChatEvent({ '/project': thread() }, { token: 'token-1', kind: 'report', reply: 'Hello ' })
    const done = applyCopilotChatEvent(first, { token: 'token-1', kind: 'end', reply: 'world', conversationId: 'conversation-1', turnId: 'turn-1', title: 'Greeting' })
    expect(done['/project'].messages[1].content).toBe('Hello world')
    expect(done['/project']).toMatchObject({ conversationId: 'conversation-1', turnId: 'turn-1', title: 'Greeting', busyToken: null, error: null })
  })

  it('ignores progress for another window or completed request', () => {
    const threads = { '/project': thread() }
    expect(applyCopilotChatEvent(threads, { token: 'other', kind: 'report', reply: 'leak' })).toBe(threads)
  })
})
