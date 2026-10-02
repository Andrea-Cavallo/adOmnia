import { describe, expect, it } from 'vitest'
import { isLocalAIProvider } from './goide-api'

describe('isLocalAIProvider', () => {
  it('accepts only loopback Ollama or compatible endpoints', () => {
    expect(isLocalAIProvider({ provider: 'ollama', baseURL: 'http://localhost:11434' })).toBe(true)
    expect(isLocalAIProvider({ provider: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' })).toBe(true)
    expect(isLocalAIProvider({ provider: 'ollama', baseURL: 'http://gpu-box.corp:11434' })).toBe(false)
    expect(isLocalAIProvider({ provider: 'openai', baseURL: 'http://localhost:8080' })).toBe(false)
    expect(isLocalAIProvider({ provider: 'openai-compatible', baseURL: 'not a url' })).toBe(false)
  })
})
