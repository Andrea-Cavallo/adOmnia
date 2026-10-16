import { useMemo, type CSSProperties } from 'react'
import { GitBranch, GitCommitHorizontal, GitMerge, Tag } from 'lucide-react'
import { GitCommitGraph } from '@/components/workspace/git/GitCommitGraph'
import { buildGitGraphLayout } from '@/lib/git/graphLayout'
import type { CommitInfo } from '@/lib/git/types'
import './goStudioGitLog.css'

interface Props {
  commits: CommitInfo[]
  selectedHash: string
  onSelect: (hash: string) => void
}

// Dedicated graph colors stay visible even with a monochrome theme accent.
const COLORS = ['#22b8a8', '#8b7cf8', '#e7a33e', '#e56b9f', '#549ced', '#83b64b'] as const

export function GoStudioGitLog({ commits, selectedHash, onSelect }: Props) {
  const graph = useMemo(() => buildGitGraphLayout(commits), [commits])
  const columns = `156px ${Math.max(100, graph.width)}px minmax(240px, 1fr) 150px`
  return (
    <div className="gs-git-history">
      <div className="gs-git-history-summary"><span><GitCommitHorizontal size={14} /> Commit history</span><span>{commits.length} commits</span></div>
      <div className="gs-git-history-scroll" role="listbox" aria-label="Repository commits">
        <div className="gs-git-history-table" style={{ minWidth: 546 + Math.max(100, graph.width) }}>
          <div className="gs-git-history-head" style={{ gridTemplateColumns: columns }} aria-hidden="true"><span>Branch / tag</span><span>Graph</span><span>Commit message</span><span>Author / date</span></div>
          {commits.length === 0 && <p className="p-4 text-[12px] text-text-4">No commits yet.</p>}
          {commits.map((commit, index) => {
            const row = graph.rows[index]
            const color = COLORS[row.nodeColor % COLORS.length]
            const height = Math.max(40, commit.decorations.length * 24 + 8)
            return <button key={commit.fullHash} type="button" role="option" aria-selected={selectedHash === commit.fullHash} aria-label={`${commit.parents.length > 1 ? 'Merge: ' : ''}${commit.message}`} onClick={() => onSelect(commit.fullHash)}
              style={{ gridTemplateColumns: columns, height, '--git-lane': color } as CSSProperties}
              className="gs-git-history-row">
              <span className="gs-git-history-refs">{commit.decorations.map((ref) => {
                const isTag = ref.startsWith('tag:')
                const isHead = ref.startsWith('HEAD')
                const Icon = isTag ? Tag : GitBranch
                return <span key={ref} title={ref} className={`gs-git-history-ref${isHead ? ' is-head' : ''}${isTag ? ' is-tag' : ''}`}><Icon size={11} /><span>{ref}</span></span>
              })}</span>
              <span className="gs-git-history-graph"><GitCommitGraph layout={row} width={Math.max(100, graph.width)} height={height} colors={COLORS} /></span>
              <span className="gs-git-history-message">{row.isMerge && <GitMerge size={13} className="shrink-0 text-text-4" />}<span title={commit.message}>{commit.message}</span><code>{commit.hash.slice(0, 7)}</code></span>
              <span className="gs-git-history-author" title={`${commit.author} · ${commit.date}`}><span>{commit.author}</span><time>{commit.date}</time></span>
            </button>
          })}
        </div>
      </div>
    </div>
  )
}
