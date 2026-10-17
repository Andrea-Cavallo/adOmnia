import { describe, expect, it } from 'vitest'
import { copiesForKey, copiesInOtherSessions } from './codeStudioSharedCopies'

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

describe('copiesForKey', () => {
  it('finds the copies from the key alone, so the result can be memoized', () => {
    const documents = [doc('a', 's1', '/repo/main.go'), doc('b', 's2', '/repo/main.go', true), doc('c', 's2', '/repo/other.go', true)]
    const key = { path: '/repo/main.go', sessionId: 's1' }
    expect(copiesForKey(documents, key).map((item) => item.document.id)).toEqual(['b'])
    // La stessa chiave (stessi valori) deve dare lo stesso risultato: è ciò che il
    // useMemo di CodeStudioEditor usa come dipendenza al posto dell'oggetto documento.
    expect(copiesForKey(documents, { ...key }).map((item) => item.document.id)).toEqual(['b'])
  })

  it('honours readOnly without the whole document', () => {
    expect(copiesForKey([doc('b', 's2', '/go/src/fmt/print.go', false, true)], { path: '/go/src/fmt/print.go', sessionId: 's1', readOnly: true })).toEqual([])
  })
})
