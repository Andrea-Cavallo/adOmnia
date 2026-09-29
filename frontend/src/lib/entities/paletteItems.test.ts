import { describe, expect, it } from 'vitest'
import { fuzzyScore } from '@/lib/commandPalette'
import { entityPaletteItems, symbolPaletteItems } from './paletteItems'
import type { DevSnapshot } from '../devcontext-api'

const snapshot: DevSnapshot = {
  sessionId: 's1', root: '/p', version: 1, warnings: [], scannedAt: '',
  entities: [
    { id: 'route:POST /payments', kind: 'route', label: 'POST /payments', attrs: { handler: 'createPayment' }, confidence: 'inferred', sources: [{ detector: 'goroutes', file: 'cmd/api/main.go', line: 7 }] },
    { id: 'table:payments', kind: 'table', label: 'payments', attrs: {}, confidence: 'inferred', sources: [{ detector: 'goliterals', file: 'store.go', line: 6 }] },
    { id: 'datasource:postgres@localhost:5432/payments', kind: 'datasource', label: 'postgres@localhost:5432/payments', attrs: { type: 'postgres' }, confidence: 'certain', sources: [{ detector: 'compose', file: 'docker-compose.yml', line: 2 }] },
  ],
}

describe('palette items', () => {
  it('describes kind, origin and confidence', () => {
    const [route, table, db] = entityPaletteItems(snapshot)
    expect(route.subtitle).toBe('Route · cmd/api/main.go:7 · inferred')
    expect(db.subtitle).toBe('Datasource · docker-compose.yml:2')
    expect(route.ref).toMatchObject({ kind: 'route', sessionId: 's1' })
    expect(route.keywords).toContain('createPayment')
    expect(table.id).toBe('entity:table:payments')
  })

  it('makes "payment" find routes, tables and datasources', () => {
    const matches = entityPaletteItems(snapshot).filter((item) => fuzzyScore('payment', `${item.title} ${item.subtitle} ${item.keywords}`) !== null)
    expect(matches).toHaveLength(3)
  })

  it('maps gopls symbols to gO locations', () => {
    const [item] = symbolPaletteItems([{ name: 'createPayment', kind: 12, container: 'api', location: { uri: '', path: '/p/api/h.go', relativePath: 'api/h.go', external: false, range: { startLine: 10, startColumn: 1, endLine: 10, endColumn: 5 } } } as never], 's1')
    expect(item).toMatchObject({ title: 'createPayment', subtitle: 'Symbol · api/h.go:10', ref: { kind: 'symbol', source: { file: 'api/h.go', line: 10 }, sessionId: 's1' } })
  })
})
