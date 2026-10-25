import { describe, expect, it } from 'vitest'
import { parseRecentFiles, recentFileFolder, timeAgo, withRecentFile } from './recentFiles'

const file = { name: 'main.go', relativePath: 'cmd/secscan/main.go', projectName: 'adOmnia', projectRoot: 'C:/adOmnia' }

describe('recent files', () => {
  it('keeps the newest first without duplicates', () => {
    const first = withRecentFile([], file, 1)
    const other = withRecentFile(first, { ...file, name: 'go.mod', relativePath: 'go.mod' }, 2)
    const again = withRecentFile(other, file, 3)
    expect(again.map((item) => [item.relativePath, item.openedAt])).toEqual([['cmd/secscan/main.go', 3], ['go.mod', 2]])
  })

  it('ignores corrupt storage', () => {
    expect(parseRecentFiles('{bad')).toEqual([])
    expect(parseRecentFiles(JSON.stringify([{ name: 1 }, { ...file, openedAt: 5 }]))).toHaveLength(1)
  })

  it('formats folder and age', () => {
    expect(recentFileFolder({ ...file, openedAt: 0 })).toBe('adOmnia/cmd/secscan')
    expect(recentFileFolder({ ...file, relativePath: 'go.mod', openedAt: 0 })).toBe('adOmnia')
    const hour = 3_600_000
    expect(timeAgo(0, 30_000)).toBe('now')
    expect(timeAgo(0, 2 * hour)).toBe('2h ago')
    expect(timeAgo(0, 50 * hour)).toBe('2d ago')
  })
})
