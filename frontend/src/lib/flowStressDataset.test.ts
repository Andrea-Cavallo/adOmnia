import { describe, expect, it } from 'vitest'
import { parseStressDataset, stressDatasetRow } from './flowStressDataset'

describe('flow stress datasets', () => {
  it('parses quoted CSV values and maps rows to variables', () => {
    const data = parseStressDataset('user,note\r\nalice,"hello, world"\r\nbob,"line 1\nline 2"\r\n')
    expect(data.columns).toEqual(['user', 'note'])
    expect(data.rows[0]).toEqual({ user: 'alice', note: 'hello, world' })
    expect(data.rows[1].note).toBe('line 1\nline 2')
  })

  it('supports shared, per-VU and random row allocation', () => {
    const data = parseStressDataset('id\na\nb\nc\n')
    expect(stressDatasetRow(data, 'shared', 2, 4).id).toBe('b')
    expect(stressDatasetRow(data, 'per-vu', 2, 0).id).toBe('c')
    expect(stressDatasetRow(data, 'random', 0, 0, () => 0.99).id).toBe('c')
  })

  it('rejects unsafe or duplicate headers', () => {
    expect(() => parseStressDataset('bad header\nx')).toThrow('valid variable names')
    expect(() => parseStressDataset('id,id\na,b')).toThrow('unique')
  })
})
