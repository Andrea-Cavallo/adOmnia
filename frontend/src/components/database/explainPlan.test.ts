import { describe, expect, it } from 'vitest'
import { maxWeight, mysqlTree, parsePlan } from './explainPlan'
import type { DbResult } from './dbShared'

const base = { rowsAffected: 0, durationMs: 1, limited: false, destructive: false, statementType: 'EXPLAIN' }

describe('parsePlan', () => {
  it('builds the SQLite tree and flags full scans', () => {
    const plan = parsePlan({
      ...base, driver: 'sqlite', explain: 'plan', columns: ['id', 'parent', 'notused', 'detail'],
      rows: [
        { id: 2, parent: 0, notused: 0, detail: 'SCAN o' },
        { id: 5, parent: 0, notused: 0, detail: 'SEARCH u USING INTEGER PRIMARY KEY (rowid=?)' },
        { id: 7, parent: 5, notused: 0, detail: 'SCAN t USING INDEX ix' },
      ],
    } as DbResult)!
    expect(plan.nodes.map((n) => n.label)).toEqual(['SCAN o', 'SEARCH u USING INTEGER PRIMARY KEY (rowid=?)'])
    expect(plan.nodes[0].warn).toBe('Full scan')
    expect(plan.nodes[1].children[0].warn).toBeUndefined()
  })

  it('reads Postgres JSON plans with ANALYZE timings and bad estimates', () => {
    const json = JSON.stringify([{
      Plan: {
        'Node Type': 'Hash Join', 'Startup Cost': 1, 'Total Cost': 40, 'Plan Rows': 5, 'Actual Total Time': 2.5, 'Actual Rows': 900, 'Actual Loops': 1,
        'Hash Cond': '(o.user_id = u.id)',
        Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Startup Cost': 0, 'Total Cost': 20, 'Plan Rows': 900, 'Actual Total Time': 1, 'Actual Rows': 900, 'Actual Loops': 1 }],
      },
      'Planning Time': 0.1, 'Execution Time': 2.7,
    }])
    const plan = parsePlan({ ...base, driver: 'postgres', explain: 'analyze', columns: ['QUERY PLAN'], rows: [{ 'QUERY PLAN': json }] } as DbResult)!
    const root = plan.nodes[0]
    expect(root.label).toBe('Hash Join')
    expect(root.warn).toBe('Row estimate off ×180')
    expect(root.children[0].label).toBe('Seq Scan on orders')
    expect(root.children[0].warn).toBe('Full scan')
    expect(plan.summary).toEqual([['Planning Time', '0.1 ms'], ['Execution Time', '2.7 ms']])
    expect(root.weight).toBeCloseTo(1.5) // self time: 2.5 inclusive − 1 child
    expect(maxWeight(plan.nodes)).toBeCloseTo(1.5)
  })

  it('parses the MySQL ANALYZE tree by indentation', () => {
    const text = [
      '-> Nested loop inner join  (cost=2.1 rows=3) (actual time=0.05..0.09 rows=3 loops=1)',
      '    -> Table scan on o  (cost=0.55 rows=3) (actual time=0.02..0.03 rows=3 loops=1)',
      '    -> Single-row index lookup on u using PRIMARY (id=o.user_id)  (cost=0.28 rows=1) (actual time=0.01..0.01 rows=1 loops=3)',
    ].join('\n')
    const nodes = mysqlTree(text)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].children.map((c) => c.label)).toEqual(['Table scan on o', 'Single-row index lookup on u using PRIMARY (id=o.user_id)'])
    expect(nodes[0].children[0].warn).toBe('Full scan')
    expect(nodes[0].children[1].weight).toBeCloseTo(0.03)
    const lines = ['-> A  (actual time=0.1..0.5 rows=1 loops=1)', '    -> B  (cost=9 rows=1) (never executed)']
    expect(mysqlTree(lines.join('\n'))[0].children[0].weight).toBe(0)
  })

  it('ignores results that are not plans', () => {
    expect(parsePlan({ ...base, driver: 'sqlite', columns: ['a'], rows: [{ a: 1 }] } as DbResult)).toBeNull()
  })
})
