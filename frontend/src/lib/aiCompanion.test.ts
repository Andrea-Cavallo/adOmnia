import { describe, expect, it } from 'vitest'
import { buildCompanionPrompt, COMPANION_WELCOME, inferCompanionRequestAction, isAICompanionAvailable, isBugHuntPlayIntent, materializeCompanionRequest, parseCompanionReply } from './aiCompanion'
import { blankRequest } from './types'

describe('a0 companion protocol', () => {
  it('uses a generic English welcome and requires English replies', () => {
    expect(COMPANION_WELCOME).toBe('Hi — what would you like to work on?')
    expect(buildCompanionPrompt('ciao', [], undefined).system).toContain('Always reply in English')
  })

  it('authorizes structured workspace mutations only when agent actions are enabled', () => {
    const readOnly = buildCompanionPrompt('Create a greeting API.', [], undefined, false).system
    const agent = buildCompanionPrompt('Create a greeting API.', [], undefined, true).system

    expect(readOnly).toContain('Do not return workspaceActions')
    expect(agent).toContain('create-request')
    expect(agent).toContain('explicitly asks')
  })

  it('materializes a safe root request from a structured assistant action', () => {
    const reply = parseCompanionReply(JSON.stringify({
      reply: 'Created a greeting request.',
      mood: 'happy',
      headerSuggestions: [],
      actions: [],
      workspaceActions: [{
        type: 'create-request',
        name: 'Greeting API',
        method: 'GET',
        url: 'http://127.0.0.1:3000/hello',
        headers: [{ key: 'Accept', value: 'application/json' }],
      }],
    }))

    expect(reply.workspaceActions).toHaveLength(1)
    const request = materializeCompanionRequest(reply.workspaceActions[0])
    expect(request).toMatchObject({ name: 'Greeting API', method: 'GET', url: 'http://127.0.0.1:3000/hello' })
    expect(request.headers[0]).toMatchObject({ key: 'Accept', value: 'application/json', enabled: true })
  })

  it('handles the explicit Italian greeting-request command without relying on the provider', () => {
    expect(inferCompanionRequestAction('Creami una API che ti saluta, nuova fuori dalle collection')).toMatchObject({
      type: 'create-request',
      name: 'Greeting API',
      method: 'GET',
      url: 'http://127.0.0.1:3000/hello',
    })
    expect(inferCompanionRequestAction('Non creare una greeting API fuori dalle collection')).toBeNull()
  })

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

  it('recognises explicit English and Italian requests to play Bug Hunt', () => {
    expect(isBugHuntPlayIntent('I want to play')).toBe(true)
    expect(isBugHuntPlayIntent("Let's play Bug Hunt!" )).toBe(true)
    expect(isBugHuntPlayIntent('Voglio giocare')).toBe(true)
    expect(isBugHuntPlayIntent('Giochiamo?')).toBe(true)
    expect(isBugHuntPlayIntent('Posso giocare?')).toBe(true)
    expect(isBugHuntPlayIntent('Facciamo una partita')).toBe(true)
    expect(isBugHuntPlayIntent('Avvia il gioco')).toBe(true)
  })

  it('does not launch the game for mentions or negative requests', () => {
    expect(isBugHuntPlayIntent('Tell me about Bug Hunt')).toBe(false)
    expect(isBugHuntPlayIntent("I don't want to play")).toBe(false)
    expect(isBugHuntPlayIntent('Non voglio giocare')).toBe(false)
    expect(isBugHuntPlayIntent('Non aprire il gioco')).toBe(false)
  })
})
