import { describe, expect, it } from 'vitest'
import { containsScripts, parseReceived, REDACTED, shareableEnvironments } from './receive'

describe('parseReceived', () => {
  it('importa una collection con ID nuovi e segreti svuotati', () => {
    const data = { id: 'c1', name: 'Payments', children: [{ id: 'r1', type: 'request', name: 'Pay', method: 'POST', url: '/pay', headers: [{ id: 'h', key: 'Authorization', value: REDACTED, enabled: true }], params: [], bodies: [] }] }
    const got = parseReceived('collection', 'Payments', data, 'Bob')
    if (got.kind !== 'collection') throw new Error('kind')
    expect(got.collection.id).not.toBe('c1')
    expect(got.collection.name).toBe('Payments (da Bob)')
    const req = got.collection.children[0]
    expect(req.id).not.toBe('r1')
    expect(req.type === 'request' && req.headers[0].value).toBe('')
  })

  it('rifiuta contenuti malformati', () => {
    expect(() => parseReceived('collection', 'x', { name: 'x' }, 'B')).toThrow()
    expect(() => parseReceived('request', 'x', { type: 'folder' }, 'B')).toThrow()
    expect(() => parseReceived('exe', 'x', {}, 'B')).toThrow()
  })

  it('normalizza gli environment ricevuti', () => {
    const got = parseReceived('environments', '', [{ name: 'DEV', variables: [{ key: 'token', value: REDACTED, type: 'secret' }, { key: 'base', value: 'http://x' }] }], 'Bob')
    if (got.kind !== 'environments') throw new Error('kind')
    expect(got.environments[0].variables.map((v) => [v.key, v.value, v.type])).toEqual([['token', '', 'secret'], ['base', 'http://x', 'text']])
  })
})

describe('containsScripts', () => {
  it('rileva script annidati e ignora quelli vuoti', () => {
    expect(containsScripts({ children: [{ type: 'request', scripts: { pre: 'pm.x()' } }] })).toBe(true)
    expect(containsScripts({ preScript: '  ', children: [{ scripts: { pre: '' } }] })).toBe(false)
  })
})

describe('shareableEnvironments', () => {
  it('esclude environment privati e valori segreti', () => {
    const envs = shareableEnvironments([
      { id: 'a', name: 'DEV', variables: [{ id: '1', key: 'k', value: 's3cr3t', enabled: true, type: 'secret' }] },
      { id: 'b', name: 'Mine', private: true, variables: [] },
    ])
    expect(envs).toHaveLength(1)
    expect(envs[0].variables[0].value).toBe('')
  })
})
