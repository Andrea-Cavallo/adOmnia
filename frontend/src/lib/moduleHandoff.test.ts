import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handOffOpenApiURL, takeOpenApiURLHandoff } from './moduleHandoff'

// L'ambiente dei test è Node: il handoff usa `sessionStorage`, che qui si sostituisce con una mappa.
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAPI handoff to API Docs', () => {
  it('hands off the base URL of the running service and consumes it once', () => {
    handOffOpenApiURL('http://localhost:8000')
    expect(takeOpenApiURLHandoff()).toBe('http://localhost:8000')
    expect(takeOpenApiURLHandoff()).toBeNull()
  })

  it('ignores empty and malformed payloads instead of prefilling garbage', () => {
    store.set('adomnia.apidocs.pendingUrl', JSON.stringify('   '))
    expect(takeOpenApiURLHandoff()).toBeNull()
    store.set('adomnia.apidocs.pendingUrl', 'not json')
    expect(takeOpenApiURLHandoff()).toBeNull()
    store.set('adomnia.apidocs.pendingUrl', JSON.stringify({ url: 'http://x' }))
    expect(takeOpenApiURLHandoff()).toBeNull()
  })
})
