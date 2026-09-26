import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/workspace/GitSyncPanel.tsx'), 'utf8')

describe('GitSyncPanel commit graph', () => {
  it('keeps every loaded graph row mounted so connections survive a scroll round-trip', () => {
    expect(source).toContain('filteredCommits.map((commit, index) =>')
    expect(source).not.toContain('graphWindow.commits.map')
    expect(source).not.toContain('graphWindow.start * graphWindow.rowHeight')
  })
})
