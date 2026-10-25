import { describe, expect, it } from 'vitest'
import { HUB_PHRASES } from './hubPhrases'

describe('Hub phrases', () => {
  it('ships the thirty title/subtitle pairs, none empty', () => {
    expect(HUB_PHRASES).toHaveLength(30)
    for (const phrase of HUB_PHRASES) {
      expect(phrase.title.trim()).not.toBe('')
      expect(phrase.subtitle.trim()).not.toBe('')
    }
  })
})
