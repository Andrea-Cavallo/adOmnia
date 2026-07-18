import { describe, expect, it } from 'vitest'
import { normalizeUrlInput } from './urlInput'

describe('normalizeUrlInput', () => {
  it('trims pasted URLs and removes line breaks', () => {
    expect(normalizeUrlInput('  \nhttps://api.example.com/v1/users\t\n')).toBe('https://api.example.com/v1/users')
  })

  it('preserves variable token spacing inside the URL', () => {
    expect(normalizeUrlInput('  {{ base_url }}/v1/users  ')).toBe('{{ base_url }}/v1/users')
  })
})
