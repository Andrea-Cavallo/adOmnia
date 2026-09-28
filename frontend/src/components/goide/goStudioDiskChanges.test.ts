import { describe, expect, it } from 'vitest'
import { directoriesToRefresh, documentsToCheck, wasDeleted, type GoIDEFilesChanged } from './goStudioDiskChanges'

const batch = (changes: GoIDEFilesChanged['changes'], overflow = false): GoIDEFilesChanged => ({ changes, overflow, limited: false })

describe('disk change routing', () => {
  const documents = [{ relativePath: 'main.go' }, { relativePath: 'api/server.go' }]

  it('rechecks only the open documents that changed, or all of them on overflow', () => {
    expect(documentsToCheck(documents, batch([{ path: '/p/api/server.go', relativePath: 'api/server.go', kind: 2 }]))).toEqual([{ relativePath: 'api/server.go' }])
    expect(documentsToCheck(documents, batch([], true))).toEqual(documents)
  })

  it('reloads only loaded folders whose listing changed', () => {
    const loaded = ['', 'api', 'internal']
    const changes = batch([
      { path: '/p/api/new.go', relativePath: 'api/new.go', kind: 1 },
      { path: '/p/internal/x.go', relativePath: 'internal/x.go', kind: 2 },
      { path: '/p/gone.go', relativePath: 'gone.go', kind: 3 },
    ])
    expect(directoriesToRefresh(loaded, changes)).toEqual(['', 'api'])
    expect(directoriesToRefresh(loaded, batch([], true))).toEqual(loaded)
  })

  it('detects deleted documents', () => {
    expect(wasDeleted('main.go', batch([{ path: '/p/main.go', relativePath: 'main.go', kind: 3 }]))).toBe(true)
    expect(wasDeleted('main.go', batch([{ path: '/p/main.go', relativePath: 'main.go', kind: 2 }]))).toBe(false)
  })
})
