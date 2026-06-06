import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle,
  Download,
  Eye,
  FileWarning,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  GitPullRequest,
  RefreshCw,
  Search,
  Star,
  Upload,
  XCircle,
} from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'
import { GitCompareTab } from './GitCompareTab'
import { GitActionsTab } from './GitActionsTab'
import { DiffModal } from '@/components/response/DiffView'

interface GitStatus {
  branch: string
  dirty: boolean
  aheadCount: number
  behindCount: number
  modified: string[]
  untracked: string[]
}

interface FileChange {
  path: string
  index: string
  worktree: string
  status: string
  conflicted: boolean
}

interface BranchInfo {
  name: string
  remote: boolean
  current: boolean
  upstream: string
  commitHash: string
  updated: string
}

interface RemoteInfo {
  name: string
  url: string
}

interface CommitInfo {
  hash: string
  fullHash: string
  parents: string[]
  author: string
  date: string
  message: string
  decorations: string[]
}

interface GitOverview {
  status: GitStatus
  changes: FileChange[]
  conflicts: FileChange[]
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  stashes: string[]
  commits: CommitInfo[]
}

interface CommitChangedFile {
  status: string
  path: string
  oldPath?: string
}

const emptyStatus: GitStatus = { branch: '', dirty: false, aheadCount: 0, behindCount: 0, modified: [], untracked: [] }
const EMPTY_TREE_REF = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function laneFor(commit: CommitInfo): number {
  if (commit.parents.length > 1) return 2
  if (commit.decorations.some((d) => d.includes('origin/') || d.includes('remotes/'))) return 1
  return 0
}

function changeLabel(change: FileChange): string {
  if (change.conflicted) return 'Conflict'
  if (change.status === '??') return 'Untracked'
  if (change.index === 'A' || change.worktree === 'A') return 'Added'
  if (change.index === 'D' || change.worktree === 'D') return 'Deleted'
  if (change.index === 'R' || change.worktree === 'R') return 'Renamed'
  return 'Modified'
}

function changedFileLabel(status: string): string {
  if (status === 'A') return 'Added'
  if (status === 'D') return 'Deleted'
  if (status === 'R') return 'Renamed'
  if (status === 'C') return 'Copied'
  if (status === 'U') return 'Conflict'
  return 'Modified'
}

function changedFileClass(status: string): string {
  if (status === 'A') return 'bg-success/15 text-success'
  if (status === 'D') return 'bg-error/15 text-error'
  if (status === 'R' || status === 'C') return 'bg-accent/15 text-accent'
  if (status === 'U') return 'bg-warning/15 text-warning'
  return 'bg-surface-3 text-text-3'
}

function extractOldContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index'))
    .filter((line) => line.startsWith(' ') || line.startsWith('-'))
    .map((line) => line.slice(1))
    .join('\n')
}

function extractNewContent(diff: string): string {
  if (!diff) return '(empty or binary file)'
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---') && !line.startsWith('@@') && !line.startsWith('diff') && !line.startsWith('index'))
    .filter((line) => line.startsWith(' ') || line.startsWith('+'))
    .map((line) => line.slice(1))
    .join('\n')
}

function normalizeCommit(commit: Partial<CommitInfo>): CommitInfo {
  return {
    hash: commit.hash ?? '',
    fullHash: commit.fullHash ?? commit.hash ?? '',
    parents: Array.isArray(commit.parents) ? commit.parents : [],
    author: commit.author ?? '',
    date: commit.date ?? '',
    message: commit.message ?? '',
    decorations: Array.isArray(commit.decorations) ? commit.decorations : [],
  }
}

function normalizeBranch(branch: Partial<BranchInfo>): BranchInfo {
  return {
    name: branch.name ?? '',
    remote: branch.remote ?? false,
    current: branch.current ?? false,
    upstream: branch.upstream ?? '',
    commitHash: branch.commitHash ?? '',
    updated: branch.updated ?? '',
  }
}

function normalizeChange(change: Partial<FileChange>): FileChange {
  return {
    path: change.path ?? '',
    index: change.index ?? '',
    worktree: change.worktree ?? '',
    status: change.status ?? '',
    conflicted: change.conflicted ?? false,
  }
}

function shortBranch(name: string): string {
  return name.replace(/^remotes\//, '').replace(/^origin\//, '')
}

function CommitGraphCell({ commit, index, count }: { commit: CommitInfo; index: number; count: number }) {
  const lane = laneFor(commit)
  const x = 14 + lane * 14
  const lineTop = index === 0 ? 15 : 0
  const lineBottom = index === count - 1 ? 15 : 34
  return (
    <svg width="58" height="34" viewBox="0 0 58 34" className="shrink-0">
      {[0, 1, 2].map((l) => (
        <line key={l} x1={14 + l * 14} y1="0" x2={14 + l * 14} y2="34" stroke="var(--color-border-2)" strokeWidth="1" opacity={l === lane ? 0.7 : 0.25} />
      ))}
      <line x1={x} y1={lineTop} x2={x} y2={lineBottom} stroke={commit.parents.length > 1 ? 'var(--color-warning)' : 'var(--color-accent)'} strokeWidth="2" />
      {commit.parents.length > 1 && <path d={`M ${x} 17 C 42 17 42 5 48 5`} fill="none" stroke="var(--color-warning)" strokeWidth="1.5" />}
      <circle cx={x} cy="17" r="4.2" fill={commit.parents.length > 1 ? 'var(--color-warning)' : 'var(--color-accent)'} stroke="var(--color-surface-0)" strokeWidth="2" />
    </svg>
  )
}

export function GitSyncPanel() {
  const [repoPath, setRepoPath] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [selectedHash, setSelectedHash] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'sync' | 'actions' | 'compare'>('sync')
  const [commitFiles, setCommitFiles] = useState<CommitChangedFile[]>([])
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)
  const [commitDiffFile, setCommitDiffFile] = useState<CommitChangedFile | null>(null)
  const [commitDiffText, setCommitDiffText] = useState('')

  const status = overview?.status ?? emptyStatus
  const selectedCommit = useMemo(
    () => overview?.commits.find((commit) => commit.hash === selectedHash) ?? overview?.commits[0],
    [overview, selectedHash],
  )
  const localBranches = useMemo(() => overview?.branches.filter((branch) => !branch.remote) ?? [], [overview])
  const remoteBranches = useMemo(() => overview?.branches.filter((branch) => branch.remote) ?? [], [overview])
  const filteredCommits = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const commits = overview?.commits ?? []
    if (!needle) return commits
    return commits.filter((commit) =>
      [commit.hash, commit.author, commit.message, ...commit.decorations].some((value) => value.toLowerCase().includes(needle)),
    )
  }, [overview, query])

  const selectedCommitBaseRef = selectedCommit?.parents[0] || EMPTY_TREE_REF

  useEffect(() => {
    GitSync.IsGitInstalled().then(setGitAvailable).catch(() => setGitAvailable(false))
  }, [])

  useEffect(() => {
    if (!repoPath || !selectedCommit) {
      setCommitFiles([])
      return
    }
    let cancelled = false
    setCommitFilesLoading(true)
    setCommitFiles([])
    GitSync.CompareRefs(repoPath, selectedCommitBaseRef, selectedCommit.fullHash || selectedCommit.hash)
      .then((raw) => {
        if (cancelled) return
        setCommitFiles(parseJSON<CommitChangedFile[]>(raw, []))
      })
      .catch(() => {
        if (!cancelled) setCommitFiles([])
      })
      .finally(() => {
        if (!cancelled) setCommitFilesLoading(false)
      })
    return () => { cancelled = true }
  }, [repoPath, selectedCommit, selectedCommitBaseRef])

  const clearFeedback = () => { setError(''); setInfo('') }

  const refreshStatus = useCallback(async () => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      const raw = await GitSync.Overview(repoPath, 120)
      const parsed = parseJSON<Partial<GitOverview>>(raw, {})
      // Backend nil slices can serialize as null; coerce every collection to an
      // array so render-time `.length`/`.map` never hit null.
      const next: GitOverview = {
        status: parsed.status
          ? {
              ...emptyStatus,
              ...parsed.status,
              modified: parsed.status.modified ?? [],
              untracked: parsed.status.untracked ?? [],
            }
          : emptyStatus,
        changes: (parsed.changes ?? []).map((change) => normalizeChange(change ?? {})),
        conflicts: (parsed.conflicts ?? []).map((change) => normalizeChange(change ?? {})),
        branches: (parsed.branches ?? []).map((branch) => normalizeBranch(branch ?? {})),
        remotes: (parsed.remotes ?? []).map((remote) => ({ name: remote?.name ?? '', url: remote?.url ?? '' })),
        stashes: parsed.stashes ?? [],
        commits: (parsed.commits ?? []).map((commit) => normalizeCommit(commit ?? {})),
      }
      setOverview(next)
      setSelectedHash((current) => current || next.commits[0]?.hash || '')
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const runAction = async (action: () => Promise<void>, success: string) => {
    if (!repoPath) return
    clearFeedback()
    setLoading(true)
    try {
      await action()
      setInfo(success)
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleInit = () => runAction(
    () => GitSync.InitRepo(JSON.stringify({ repoPath, branch: status.branch || 'master' })),
    'Repository initialized.',
  )

  const handleCommit = () => runAction(async () => {
    if (!commitMsg.trim()) return
    await GitSync.CommitAll(repoPath, commitMsg.trim())
    setCommitMsg('')
  }, 'Commit created.')

  const openCommitDiff = async (file: CommitChangedFile) => {
    if (!repoPath || !selectedCommit) return
    clearFeedback()
    try {
      const diff = await GitSync.GetFileDiff(repoPath, selectedCommitBaseRef, selectedCommit.fullHash || selectedCommit.hash, file.path)
      setCommitDiffFile(file)
      setCommitDiffText(diff)
    } catch (e) {
      setError(String(e))
    }
  }

  const currentBranch = status.branch || 'master'

  if (gitAvailable === false) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AlertTriangle size={32} className="text-warning" />
          <p className="text-sm font-medium text-text-1">Git not found</p>
          <p className="text-xs text-text-3">Install Git and ensure it is on your PATH to use Git Sync.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border-1 bg-surface-1 px-3">
        <div className="mr-3 flex items-center gap-2">
          <GitBranch size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-1">Git Sync</span>
        </div>
        <button onClick={() => runAction(() => GitSync.Fetch(repoPath), 'Fetch complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} /> Fetch
        </button>
        <button onClick={() => runAction(() => GitSync.Pull(repoPath, currentBranch), 'Pull complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <Download size={13} /> Pull
        </button>
        <button onClick={() => runAction(() => GitSync.Push(repoPath, currentBranch), 'Push complete.')} disabled={!repoPath || loading} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-40">
          <Upload size={13} /> Push
        </button>
        <button onClick={() => runAction(() => GitSync.Stash(repoPath), 'Working changes stashed.')} disabled={!repoPath || loading || !status.dirty} className="flex h-8 items-center gap-1.5 rounded px-2 text-xs text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:text-text-4 disabled:opacity-40">
          <Archive size={13} /> Stash
        </button>
        <div className="mx-2 h-6 w-px bg-border-2" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FolderOpen size={13} className="shrink-0 text-text-4" />
          <input
            className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-2 px-2 text-xs text-text-1 outline-none focus:border-accent"
            placeholder="Repository path..."
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
          />
          <button onClick={handleInit} disabled={!repoPath || loading} className="h-8 rounded border border-border-1 px-3 text-xs text-text-2 hover:bg-surface-2 disabled:opacity-40">Init</button>
          <button onClick={refreshStatus} disabled={!repoPath || loading} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">Load</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border-1 bg-surface-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab('sync')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'sync' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Sync
        </button>
        <button
          onClick={() => setActiveTab('compare')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'compare' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Compare
        </button>
        <button
          onClick={() => setActiveTab('actions')}
          className={cn(
            'px-4 py-2 text-[11px] font-medium transition-colors',
            activeTab === 'actions' ? 'text-accent border-b-2 border-accent' : 'text-text-4 hover:text-text-2',
          )}
        >
          Actions
        </button>
      </div>

      {activeTab === 'compare' ? (
        <GitCompareTab repoPath={repoPath} />
      ) : activeTab === 'actions' ? (
        <GitActionsTab
          repoPath={repoPath}
          currentBranch={currentBranch}
          changes={overview?.changes ?? []}
          branches={overview?.branches ?? []}
          remotes={overview?.remotes ?? []}
          stashes={overview?.stashes ?? []}
          loading={loading}
          setRepoPath={setRepoPath}
          runAction={runAction}
        />
      ) : (
        <>
      {(error || info) && (
        <div className={cn('flex items-center gap-2 border-b px-3 py-2 text-xs', error ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')}>
          {error ? <XCircle size={13} /> : <CheckCircle size={13} />}
          <span className="truncate">{error || info}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 overflow-y-auto border-r border-border-1 bg-surface-1">
          <div className="border-b border-border-1 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Repository</div>
            <div className="truncate text-xs font-semibold text-text-1">{repoPath ? repoPath.split(/[\\/]/).pop() : 'No repository loaded'}</div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
              <span className="rounded border border-border-2 px-1.5 py-0.5 text-text-3">{status.branch || 'no branch'}</span>
              <span className={cn('rounded border px-1.5 py-0.5', status.dirty ? 'border-warning/50 text-warning' : 'border-success/50 text-success')}>
                {status.dirty ? `${overview?.changes.length ?? 0} changes` : 'clean'}
              </span>
              {(status.aheadCount > 0 || status.behindCount > 0) && <span className="rounded border border-border-2 px-1.5 py-0.5 text-text-3">{status.aheadCount} ahead / {status.behindCount} behind</span>}
            </div>
          </div>

          <div className="border-b border-border-1 p-3">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-2 text-text-4" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-7 w-full rounded border border-border-1 bg-surface-0 pl-7 pr-2 text-xs text-text-1 outline-none focus:border-accent" placeholder="Filter commits..." />
            </div>
          </div>

          <nav className="space-y-4 p-3 text-xs">
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><Star size={11} /> Starred</div>
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-medium text-text-1 hover:bg-surface-2">
                <Check size={12} className="text-success" /> {status.branch || 'master'}
              </button>
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><GitFork size={11} /> Branches</div>
              {localBranches.length === 0 && <div className="px-2 py-1 text-text-4">No local branches loaded</div>}
              {localBranches.map((branch) => (
                <button key={branch.name} className={cn('flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2', branch.current ? 'text-accent' : 'text-text-2')}>
                  <span className="truncate">{shortBranch(branch.name)}</span>
                  {branch.current && <Check size={11} />}
                </button>
              ))}
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><GitPullRequest size={11} /> Remotes</div>
              {overview?.remotes.map((item) => (
                <div key={item.name} className="rounded px-2 py-1.5 text-text-2">
                  <div className="font-medium">{item.name}</div>
                  <div className="truncate text-[10px] text-text-4">{item.url}</div>
                </div>
              ))}
              {remoteBranches.slice(0, 8).map((branch) => (
                <div key={branch.name} className="truncate rounded px-2 py-1 text-text-3">{shortBranch(branch.name)}</div>
              ))}
            </section>
            <section>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-text-4"><Archive size={11} /> Stashes</div>
              {(overview?.stashes.length ?? 0) === 0 && <div className="px-2 py-1 text-text-4">No stashes</div>}
              {overview?.stashes.map((stash) => <div key={stash} className="truncate rounded px-2 py-1 text-text-3">{stash}</div>)}
            </section>
          </nav>
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden">
          <div className="grid h-10 shrink-0 grid-cols-[64px_minmax(0,1fr)_170px_90px_96px] items-center border-b border-border-1 bg-surface-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">
            <span>Graph</span><span>Commit</span><span>Author</span><span>Hash</span><span>Date</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredCommits.map((commit, index) => (
              <button
                key={commit.fullHash || commit.hash}
                onClick={() => setSelectedHash(commit.hash)}
                className={cn('grid w-full grid-cols-[64px_minmax(0,1fr)_170px_90px_96px] items-center border-b border-border-1 px-2 text-left hover:bg-surface-2', selectedCommit?.hash === commit.hash && 'bg-surface-2')}
              >
                <CommitGraphCell commit={commit} index={index} count={filteredCommits.length} />
                <div className="min-w-0 py-2">
                  <div className="truncate text-xs font-medium text-text-1">{commit.message}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {commit.decorations.slice(0, 3).map((decoration) => (
                      <span key={decoration} className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent">{decoration}</span>
                    ))}
                    {commit.parents.length > 1 && <span className="rounded border border-warning/40 px-1.5 py-0.5 text-[10px] text-warning">merge</span>}
                  </div>
                </div>
                <span className="truncate text-xs text-text-2">{commit.author}</span>
                <code className="text-xs text-accent">{commit.hash}</code>
                <span className="text-xs text-text-3">{commit.date}</span>
              </button>
            ))}
            {repoPath && filteredCommits.length === 0 && <div className="p-8 text-center text-xs text-text-4">No commits found.</div>}
            {!repoPath && <div className="p-8 text-center text-xs text-text-4">Load a repository to inspect the graph.</div>}
          </div>

          <section className="h-72 shrink-0 overflow-hidden border-t border-border-1 bg-surface-1">
            {selectedCommit ? (
              <div className="grid h-full grid-cols-[minmax(260px,.85fr)_minmax(320px,1.15fr)]">
                <div className="min-w-0 overflow-y-auto border-r border-border-1 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-1">
                    {selectedCommit.parents.length > 1 ? <GitMerge size={15} className="text-warning" /> : <GitCommit size={15} className="text-accent" />}
                    <span className="truncate">{selectedCommit.message}</span>
                  </div>
                  <div className="grid gap-3 text-xs">
                    <div className="rounded border border-border-1 bg-surface-0 p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-4">Author</div>
                      <div className="text-text-1">{selectedCommit.author}</div>
                      <div className="mt-1 text-text-4">{selectedCommit.date}</div>
                    </div>
                    <div className="rounded border border-border-1 bg-surface-0 p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-text-4">Refs</div>
                      <div className="font-mono text-text-2">sha {selectedCommit.fullHash}</div>
                      <div className="mt-1 font-mono text-text-4">base {selectedCommit.parents[0] || 'empty tree'}</div>
                      {selectedCommit.parents.length > 1 && <div className="mt-1 text-warning">Merge commit: showing files against first parent.</div>}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-col">
                  <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-1 px-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Files changed by this commit</div>
                    <span className="text-[10px] text-text-4">{commitFilesLoading ? 'loading...' : `${commitFiles.length} files`}</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {commitFilesLoading && <div className="rounded border border-border-1 bg-surface-0 p-4 text-center text-xs text-text-4">Loading commit files...</div>}
                    {!commitFilesLoading && commitFiles.length === 0 && <div className="rounded border border-border-1 bg-surface-0 p-4 text-center text-xs text-text-4">No file changes found for this commit.</div>}
                    <div className="space-y-1">
                      {commitFiles.map((file) => (
                        <button
                          key={`${file.status}-${file.path}-${file.oldPath ?? ''}`}
                          onClick={() => void openCommitDiff(file)}
                          className="flex w-full items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5 text-left hover:bg-surface-2"
                        >
                          <span className={cn('w-14 rounded px-1.5 py-0.5 text-center text-[9px]', changedFileClass(file.status))}>{changedFileLabel(file.status)}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-2">{file.path}</span>
                          {file.oldPath && <span className="max-w-[150px] truncate text-[10px] text-text-4">from {file.oldPath}</span>}
                          <Eye size={12} className="shrink-0 text-text-4" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-text-4">Select a commit to inspect details.</div>
            )}
          </section>
        </main>

        <aside className="min-h-0 overflow-y-auto border-l border-border-1 bg-surface-1">
          <div className="border-b border-border-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Commit</div>
              <span className="text-[10px] text-text-4">{overview?.changes.length ?? 0} files</span>
            </div>
            <div className="flex gap-2">
              <input
                className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent"
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(event) => setCommitMsg(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleCommit()}
              />
              <button onClick={handleCommit} disabled={!repoPath || !commitMsg.trim() || loading} className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">Commit</button>
            </div>
          </div>

          {(overview?.conflicts.length ?? 0) > 0 && (
            <section className="border-b border-border-1 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning"><FileWarning size={13} /> Merge conflicts</div>
              <div className="space-y-2">
                {overview?.conflicts.map((change) => (
                  <div key={change.path} className="rounded border border-warning/40 bg-warning/10 p-2">
                    <div className="truncate text-xs font-medium text-text-1">{change.path}</div>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <button onClick={() => runAction(() => GitSync.CheckoutConflictSide(repoPath, change.path, 'ours'), `Kept ours for ${change.path}.`)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">Ours</button>
                      <button onClick={() => runAction(() => GitSync.CheckoutConflictSide(repoPath, change.path, 'theirs'), `Kept theirs for ${change.path}.`)} className="rounded border border-border-2 px-2 py-1 text-[10px] text-text-2 hover:text-text-1">Theirs</button>
                      <button onClick={() => runAction(() => GitSync.StageFile(repoPath, change.path), `Staged ${change.path}.`)} className="rounded border border-accent/50 px-2 py-1 text-[10px] text-accent">Stage</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => runAction(() => GitSync.AbortIntegration(repoPath), 'Merge/rebase aborted.')} className="mt-2 w-full rounded border border-error/40 px-2 py-1.5 text-xs text-error hover:bg-error/10">Abort merge/rebase</button>
            </section>
          )}

          <section className="p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-4">Changes</div>
            <div className="space-y-1">
              {(overview?.changes ?? []).map((change) => (
                <div key={`${change.status}-${change.path}`} className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5">
                  <span className={cn('w-14 rounded px-1.5 py-0.5 text-center text-[9px]', change.conflicted ? 'bg-warning/20 text-warning' : change.status === '??' ? 'bg-accent/15 text-accent' : 'bg-surface-3 text-text-3')}>
                    {changeLabel(change)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-2">{change.path}</span>
                </div>
              ))}
              {(overview?.changes.length ?? 0) === 0 && <div className="rounded border border-border-1 bg-surface-0 p-4 text-center text-xs text-text-4">Working tree clean.</div>}
            </div>
          </section>
        </aside>
      </div>
        </>
      )}
      {commitDiffFile && (
        <DiffModal
          leftLabel={`${selectedCommitBaseRef} - ${commitDiffFile.path}`}
          rightLabel={`${selectedCommit?.hash ?? 'commit'} - ${commitDiffFile.path}`}
          leftBody={extractOldContent(commitDiffText)}
          rightBody={extractNewContent(commitDiffText)}
          onClose={() => {
            setCommitDiffFile(null)
            setCommitDiffText('')
          }}
        />
      )}
    </div>
  )
}
