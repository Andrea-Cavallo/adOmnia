import { describe, expect, it } from 'vitest'
import { copiesInOtherSessions } from './goStudioSharedCopies'

const doc = (id: string, sessionId: string, path: string, dirty = false, readOnly = false) => ({ document: { id, sessionId, path, readOnly }, dirty })

describe('copiesInOtherSessions', () => {
  it('finds the same file open in another project only', () => {
    const active = doc('a', 's1', '/repo/svc/main.go')
    const documents = [active, doc('b', 's2', '/repo/svc/main.go', true), doc('c', 's1', '/repo/svc/main.go'), doc('d', 's2', '/repo/svc/other.go')]
    expect(copiesInOtherSessions(documents, active).map((item) => item.document.id)).toEqual(['b'])
  })

  it('ignores read-only SDK files shared by every project', () => {
    const active = doc('a', 's1', '/go/src/fmt/print.go', false, true)
    expect(copiesInOtherSessions([active, doc('b', 's2', '/go/src/fmt/print.go', false, true)], active)).toEqual([])
  })
})
