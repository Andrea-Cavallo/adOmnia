import { describe, expect, it } from 'vitest'
import { sqlStatementAt } from './sqlStatement'

describe('sqlStatementAt', () => {
  const sql = 'select 1;\nselect 2 from t;\nselect 3'
  it('returns the statement around the caret', () => {
    expect(sqlStatementAt(sql, 3)).toBe('select 1')
    expect(sqlStatementAt(sql, sql.indexOf('from'))).toBe('select 2 from t')
    expect(sqlStatementAt(sql, sql.length)).toBe('select 3')
  })
  it('keeps a caret right after a semicolon on the statement it ends', () => {
    expect(sqlStatementAt(sql, 9)).toBe('select 1')
  })
})
