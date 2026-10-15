import { useMemo } from 'react'
import { GitCommitGraph } from '@/components/workspace/git/GitCommitGraph'
import { buildGitGraphLayout } from '@/lib/git/graphLayout'
import type { CommitInfo } from '@/lib/git/types'

interface Props {
  commits: CommitInfo[]
  selectedHash: string
  onSelect: (hash: string) => void
}

/** The IDE uses the same parent topology and renderer as Git Studio. */
export function GoStudioGitLog({ commits, selectedHash, onSelect }: Props) {
  const graph = useMemo(() => buildGitGraphLayout(commits), [commits])
  return (
    <div role="listbox" aria-label="Repository commits" className="min-w-0 overflow-auto border-r border-border-1">
      {commits.length === 0 && <p className="p-4 text-[12px] text-text-4">No commits yet.</p>}
      <div className="min-w-max">
        {commits.map((commit, index) => (
          <button key={commit.fullHash} type="button" role="option" aria-selected={selectedHash === commit.fullHash} aria-label={`${commit.parents.length > 1 ? 'Merge: ' : ''}${commit.message}`} onClick={() => onSelect(commit.fullHash)}
            style={{ gridTemplateColumns: `${graph.width}px minmax(180px,1fr) 140px` }}
            className={`grid h-9 w-full items-center gap-2 border-b border-border-1/50 pr-2 text-left ${selectedHash === commit.fullHash ? 'bg-accent/12' : 'hover:bg-surface-2/60'}`}>
            <GitCommitGraph layout={graph.rows[index]} width={graph.width} height={36} />
            <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-text-1">
              {commit.decorations.map((ref) => <span key={ref} title={ref} className="max-w-48 shrink-0 truncate rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{ref}</span>)}
              <span className="truncate" title={`${commit.hash} · ${commit.message}`}>{commit.message}</span>
            </span>
            <span className="truncate text-[10.5px] text-text-4" title={`${commit.author} · ${commit.date}`}>{commit.author} · {commit.date}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
