import { describe, expect, it } from 'vitest'
import { buildCompanionPrompt, COMPANION_WELCOME, inferCompanionRequestAction, inferMockGenerationAction, isAICompanionAvailable, materializeCompanionRequest, parseCompanionReply } from './aiCompanion'
import { blankRequest } from './types'

describe('a0 companion protocol', () => {
  it('uses a generic welcome and answers in the language used by the user', () => {
    expect(COMPANION_WELCOME).toBe('Hi — what would you like to work on?')
    const system = buildCompanionPrompt('ciao', [], undefined).system
    expect(system).toContain('same language')
    expect(system).not.toContain('Always reply in English')
  })

  it('teaches the assistant the adOmnia capability map and relevant Mock tools', () => {
    const prompt = buildCompanionPrompt('Mockami una API REST per una todo list', [], undefined, true)

    expect(prompt.system).toContain('Mock Server')
    expect(prompt.system).toContain('Database Studio')
    expect(prompt.system).toContain('MCP')
    expect(prompt.system).toContain('generate-mock')
    expect(prompt.user).toContain('Relevant adOmnia capabilities')
  })

  it('includes a bounded recent conversation so follow-up requests keep context', () => {
    const prompt = buildCompanionPrompt('Ora mockala', [], undefined, true, [
      { role: 'user', text: 'Voglio una API per gestire una todo list.' },
      { role: 'assistant', text: 'Posso prepararla.' },
    ])

    expect(prompt.user).toContain('Recent conversation')
    expect(prompt.user).toContain('Voglio una API per gestire una todo list.')
    expect(prompt.user).toContain('Ora mockala')
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
    const action = reply.workspaceActions[0]
    expect(action.type).toBe('create-request')
    if (action.type !== 'create-request') throw new Error('expected a create-request action')
    const request = materializeCompanionRequest(action)
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

  it('recognizes Italian and English mock-generation commands deterministically', () => {
    expect(inferMockGenerationAction('Mockami una API REST per una todo list')).toEqual({
      type: 'generate-mock',
      description: 'una API REST per una todo list',
    })
    expect(inferMockGenerationAction('Create a mock API for invoices')).toEqual({
      type: 'generate-mock',
      description: 'invoices',
    })
    expect(inferMockGenerationAction('Non mockare questa API')).toBeNull()
  })

  it('accepts only validated navigation and mock actions', () => {
    const reply = parseCompanionReply(JSON.stringify({
      reply: 'Apro il Mock Server e preparo gli endpoint.',
      mood: 'thinking',
      navigationActions: [
        { type: 'open-panel', panel: 'mock' },
        { type: 'open-panel', panel: 'not-a-real-panel' },
      ],
      workspaceActions: [
        { type: 'generate-mock', description: 'API fatture con CRUD e pagamenti' },
      ],
    }))

    expect(reply.navigationActions).toEqual([{ type: 'open-panel', panel: 'mock' }])
    expect(reply.workspaceActions).toContainEqual({ type: 'generate-mock', description: 'API fatture con CRUD e pagamenti' })
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
})
