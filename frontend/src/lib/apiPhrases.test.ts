import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_PHRASES, loadApiPhrase } from './apiPhrases'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('API empty-state phrases', () => {
  it('ships the twenty title/subtitle pairs, none empty', () => {
    expect(API_PHRASES).toHaveLength(20)
    for (const phrase of API_PHRASES) {
      expect(phrase.title.trim()).not.toBe('')
      expect(phrase.subtitle.trim()).not.toBe('')
    }
  })

  it('changes phrase between visits instead of repeating it', () => {
    expect(loadApiPhrase(0)).toEqual(API_PHRASES[0])
    expect(loadApiPhrase(0)).toEqual(API_PHRASES[1])
  })
})
