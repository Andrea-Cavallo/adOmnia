import { describe, expect, it } from 'vitest'
import type { Environment } from '@/lib/types'
import { addMatrixKey, deleteMatrixKey, exportEnvironments, matrixRows, mergeEnvironments, parseEnvironmentsImport, renameMatrixKey, setMatrixValue } from './envMatrix'

const env = (id: string, name: string, vars: Array<[string, string, ('text' | 'secret')?]>, extra: Partial<Environment> = {}): Environment => ({
  id, name, variables: vars.map(([key, value, type], i) => ({ id: `${id}-${i}`, key, value, enabled: true, type: type ?? 'text' })), ...extra,
})

describe('environment matrix', () => {
  const dev = env('dev', 'Development', [['BASE_URL', 'http://localhost'], ['TOKEN', 't1', 'secret']])
  const prod = env('prod', 'Production', [['BASE_URL', 'https://api']])

  it('builds one row per key with a value per stage', () => {
    const rows = matrixRows([dev, prod])
    expect(rows.map((r) => r.key)).toEqual(['BASE_URL', 'TOKEN'])
    expect(rows[0].values).toEqual({ dev: 'http://localhost', prod: 'https://api' })
    expect(rows[1].values.prod).toBeUndefined()
    expect(rows[1].secret).toBe(true)
  })

  it('edits cells, keys and rows without mutating the input', () => {
    const set = setMatrixValue([dev, prod], 'TOKEN', 'prod', 'p1')
    expect(matrixRows(set)[1].values.prod).toBe('p1')
    expect(prod.variables).toHaveLength(1)
    expect(matrixRows(renameMatrixKey(set, 'BASE_URL', 'URL'))[0].key).toBe('URL')
    expect(matrixRows(deleteMatrixKey(set, 'TOKEN')).map((r) => r.key)).toEqual(['BASE_URL'])
    expect(addMatrixKey([dev, prod], 'NEW').every((e) => e.variables.some((v) => v.key === 'NEW'))).toBe(true)
  })

  it('exports shared environments without plain secret values', () => {
    const file = JSON.parse(exportEnvironments([dev, env('me', 'Mine', [['X', '1']], { private: true })]))
    expect(file.format).toBe('adomnia-environments')
    expect(file.environments).toHaveLength(1)
    expect(file.environments[0].variables[1]).toMatchObject({ key: 'TOKEN', value: '', type: 'secret' })
  })

  it('round-trips its own format and reads Postman environments', () => {
    const back = parseEnvironmentsImport(exportEnvironments([dev, prod]))
    expect(back.map((e) => e.name)).toEqual(['Development', 'Production'])
    const postman = parseEnvironmentsImport(JSON.stringify({ name: 'Staging', values: [{ key: 'A', value: 1, enabled: false }] }))
    expect(postman[0]).toMatchObject({ name: 'Staging', variables: [{ key: 'A', value: '1', enabled: false }] })
    expect(() => parseEnvironmentsImport('nope')).toThrow()
  })

  it('merges by name: imported values win, local-only keys stay', () => {
    const merged = mergeEnvironments([dev], [env('x', 'development', [['BASE_URL', 'http://new'], ['EXTRA', '1']]), prod])
    expect(merged).toHaveLength(2)
    const rows = matrixRows(merged)
    expect(rows.find((r) => r.key === 'BASE_URL')?.values.dev).toBe('http://new')
    expect(rows.find((r) => r.key === 'TOKEN')?.values.dev).toBe('t1')
    expect(rows.find((r) => r.key === 'EXTRA')?.values.dev).toBe('1')
  })
})
