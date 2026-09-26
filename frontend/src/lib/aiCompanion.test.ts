import { describe, expect, it } from 'vitest'
import { buildCompanionPrompt, isAICompanionAvailable, parseCompanionReply } from './aiCompanion'
import { blankRequest } from './types'

describe('a0 companion protocol', () => {
  it('accepts only safe, user-reviewable actions and headers', () => {
    const reply = parseCompanionReply(JSON.stringify({
      reply: 'Add correlation and an auth placeholder.',
      mood: 'thinking',
      headerSuggestions: [
        { key: 'X-Correlation-ID', value: '{{correlation_id}}', reason: 'Trace calls.' },
        { key: 'Bad\nHeader', value: 'nope' },
      ],
      actions: ['open-flow', 'delete-workspace', 'open-docs'],
    }))

    expect(reply.mood).toBe('thinking')
    expect(reply.headerSuggestions).toEqual([{ key: 'X-Correlation-ID', value: '{{correlation_id}}', reason: 'Trace calls.' }])
    expect(reply.actions).toEqual(['open-flow', 'open-docs'])
  })

  it('shares only request outlines and header names with the provider', () => {
    const request = blankRequest('POST', 'Create payment')
    request.url = 'https://payments.example.test/v1/payments'
    request.headers = [{ ...request.headers[0], key: 'Authorization', value: 'Bearer secret-value' }]
    const prompt = buildCompanionPrompt('Suggest headers.', [{ id: 'payments', name: 'Payments', children: [request] }], request)

    expect(prompt.user).toContain('POST https://payments.example.test/v1/payments')
    expect(prompt.user).toContain('Known header names: Authorization')
    expect(prompt.user).not.toContain('secret-value')
  })

  it('keeps a0 hidden until the selected provider and model have passed a connection test', () => {
    const ai = {
      enabled: true,
      provider: 'ollama' as const,
      model: 'qwen3.5',
      connectionVerifiedAt: '2026-09-26T12:00:00.000Z',
      connectionProvider: 'ollama' as const,
      connectionModel: 'qwen3.5',
    }

    expect(isAICompanionAvailable(ai)).toBe(true)
    expect(isAICompanionAvailable({ ...ai, connectionModel: 'another-model' })).toBe(false)
    expect(isAICompanionAvailable({ ...ai, connectionVerifiedAt: '' })).toBe(false)
  })
})
