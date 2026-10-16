import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CommitInfo } from '@/lib/git/types'
import { GoStudioGitLog } from './GoStudioGitLog'
import { GitCommitGraph } from '@/components/workspace/git/GitCommitGraph'
import { buildGitGraphLayout } from '@/lib/git/graphLayout'

const commit = (hash: string, parents: string[], decorations: string[] = []): CommitInfo => ({ hash, fullHash: hash, parents, decorations, author: 'Ada', date: '2026-10-15', message: hash })

describe('IDE Git log graph', () => {
  it('renders branch/merge paths and ref labels in the commit list', () => {
    const commits = [commit('merge', ['main', 'feature'], ['HEAD -> main']), commit('feature', ['base'], ['feature']), commit('main', ['base']), commit('base', [])]
    const html = renderToStaticMarkup(<GoStudioGitLog commits={commits} selectedHash="merge" onSelect={() => undefined} />)
    expect(html.match(/viewBox="0 0 100 40"/g)).toHaveLength(4)
    expect(html).toContain('<path')
    expect(html).toContain('HEAD -&gt; main')
    expect(html).toContain('aria-label="Merge: merge"')
    expect(html).toContain('height="40"')
    expect(html).toContain('Branch / tag')
    expect(html).toContain('Commit message')
    expect(html).toContain('stroke="#22b8a8"')
    expect(html).toContain('stroke="#8b7cf8"')
    expect(html).toContain('aria-selected="true"')
  })
  it('keeps the standalone Git Studio renderer at its existing height', () => {
    const graph = buildGitGraphLayout([commit('base', [])])
    const html = renderToStaticMarkup(<GitCommitGraph layout={graph.rows[0]} width={graph.width} />)
    expect(html).toContain('height="58"')
  })
})
