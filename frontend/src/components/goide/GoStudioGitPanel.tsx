import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GitBranch, GitFork, Loader2, RefreshCw } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import type { GoIDESession } from '@/lib/goide-api'
import { pullGoIDERepository, pushGoIDERepository } from '@/lib/goide-vcs-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { gitPathInProject } from './goStudioGitPaths'
import { GoStudioGitLog } from './GoStudioGitLog'
import type { CommitInfo as GitCommitInfo } from '@/lib/git/types'

interface GitChange { path: string; index: string; worktree: string; status: string; conflicted: boolean }
interface GitBranchInfo { name: string; remote: boolean; current: boolean; upstream: string; commitHash: string; updated: string }
interface GitOverview {
  status: { branch: string; dirty: boolean; aheadCount: number; behindCount: number }
  changes: GitChange[]
  branches: GitBranchInfo[]
  commits: GitCommitInfo[]
}
interface GitWorktree { path: string; head: string; branch: string; bare: boolean; detached: boolean }

type Tab = 'git' | 'log' | 'worktrees'

function parseJSON<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function changeLabel(change: GitChange): string {
  if (change.conflicted) return 'Conflict'
  if (change.status === '??') return 'Untracked'
  if (change.index === 'A' || change.worktree === 'A') return 'Added'
  if (change.index === 'D' || change.worktree === 'D') return 'Deleted'
  if (change.index === 'R' || change.worktree === 'R') return 'Renamed'
  return 'Modified'
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Git workbench scoped to one IDE session. It never reads the global Git Studio repository choice. */
export function GoStudioGitPanel({ session }: { session: GoIDESession }) {
  const sessionId = session.id
  const vcsStatus = useGoIDEVCSStore((state) => state.status[sessionId])
  const [tab, setTab] = useState<Tab>('log')
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [selectedHash, setSelectedHash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const repoRoot = vcsStatus?.repoRoot ?? ''
  const refreshVersion = useRef(0)
  const repositories = vcsStatus?.repositories ?? (repoRoot ? [repoRoot] : [])

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    await useGoIDEVCSStore.getState().refreshStatus(sessionId)
    if (version !== refreshVersion.current) return
    const current = useGoIDEVCSStore.getState().status[sessionId]
    const root = current?.repoRoot ?? repoRoot
    if (!current?.available || !root) { setOverview(null); setWorktrees([]); return }
    setLoading(true); setError('')
    try {
      const [rawOverview, rawWorktrees] = await Promise.all([GitSync.Overview(root, 300), GitSync.ListWorktrees(root)])
      if (version !== refreshVersion.current) return
      const parsed = parseJSON<Partial<GitOverview>>(rawOverview, {})
      const next: GitOverview = {
        status: { branch: '', dirty: false, aheadCount: 0, behindCount: 0, ...(parsed.status ?? {}) },
        changes: parsed.changes ?? [], branches: parsed.branches ?? [], commits: (parsed.commits ?? []).map((commit) => ({ ...commit, parents: commit.parents ?? [], decorations: commit.decorations ?? [] })),
      }
      setOverview(next)
      setWorktrees(parseJSON<GitWorktree[]>(rawWorktrees, []))
      setSelectedHash((value) => value && next.commits.some((commit) => commit.fullHash === value) ? value : next.commits[0]?.fullHash ?? '')
    } catch (reason) { if (version === refreshVersion.current) setError(errorText(reason)) } finally { if (version === refreshVersion.current) setLoading(false) }
  }, [repoRoot, sessionId])

  useEffect(() => { setOverview(null); void refresh(); return () => { refreshVersion.current++ } }, [refresh])
  const selectedCommit = useMemo(() => overview?.commits.find((commit) => commit.fullHash === selectedHash) ?? null, [overview, selectedHash])
  const localBranches = overview?.branches.filter((branch) => !branch.remote) ?? []
  const remoteBranches = overview?.branches.filter((branch) => branch.remote) ?? []
  const toProjectPath = (path: string): string | null => gitPathInProject(session.project.realPath, repoRoot, path)

  const sync = async (kind: 'pull' | 'push') => {
    setLoading(true); setError('')
    try {
      if (kind === 'pull') await pullGoIDERepository(sessionId); else await pushGoIDERepository(sessionId)
      await refresh()
    } catch (reason) { setError(errorText(reason)); setLoading(false) }
  }
  const toggleStage = async (change: GitChange) => {
    const staged = !!change.index && change.index !== ' ' && change.index !== '?'
    try {
      if (staged) await GitSync.UnstageFile(repoRoot, change.path); else await GitSync.StageFile(repoRoot, change.path)
      await refresh()
    } catch (reason) { setError(errorText(reason)) }
  }

  if (!vcsStatus?.available) return <div className="grid h-full place-items-center p-6 text-center text-[12px] text-text-4"><div><GitBranch size={24} className="mx-auto mb-2 opacity-60" /><p>This project is not inside a Git repository.</p></div></div>

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        {(['git', 'log', 'worktrees'] as const).map((id) => <button key={id} type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-8 border-b-2 px-3 text-[12px] font-medium capitalize ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{id === 'git' ? 'Git' : id === 'log' ? 'Log' : 'Worktrees'}</button>)}
        <select aria-label="Git repository" title={repoRoot} value={repoRoot} disabled={loading} onChange={(event) => { setLoading(true); void useGoIDEVCSStore.getState().selectRepository(sessionId, event.target.value).catch((reason) => { setError(errorText(reason)); setLoading(false) }) }} className="ml-2 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 py-1 font-mono text-[10.5px] text-text-2">
          {repositories.map((root) => <option key={root} value={root}>{root}</option>)}
        </select>
        <span className="text-[11px] text-text-3">{overview?.status.branch || vcsStatus.branch}</span>
        {(overview?.status.aheadCount ?? vcsStatus.ahead) > 0 && <span className="flex items-center gap-0.5 text-[10.5px] text-success"><ArrowUp size={11} />{overview?.status.aheadCount ?? vcsStatus.ahead}</span>}
        {(overview?.status.behindCount ?? vcsStatus.behind) > 0 && <span className="flex items-center gap-0.5 text-[10.5px] text-warning"><ArrowDown size={11} />{overview?.status.behindCount ?? vcsStatus.behind}</span>}
        <button type="button" onClick={() => void sync('pull')} disabled={loading} className="go-studio-icon-button h-7 px-2 text-[11px]" title="Pull with rebase and autostash"><ArrowDown size={12} /> Pull</button>
        <button type="button" onClick={() => void sync('push')} disabled={loading} className="go-studio-icon-button h-7 px-2 text-[11px]" title="Push current branch"><ArrowUp size={12} /> Push</button>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="go-studio-icon-button h-7 w-7" title="Refresh"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div role="alert" className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">{error}</div>}
      {loading && !overview && <div className="grid flex-1 place-items-center text-text-4"><Loader2 size={18} className="animate-spin" /></div>}

      {tab === 'git' && overview && <div className="min-h-0 flex-1 overflow-auto">
        {overview.changes.length === 0 ? <p className="p-4 text-[12px] text-text-4">Working tree clean.</p> : overview.changes.map((change) => {
          const staged = !!change.index && change.index !== ' ' && change.index !== '?'
          return <div key={change.path} className="flex h-8 items-center gap-2 border-b border-border-1/60 px-3 hover:bg-surface-2/60">
            <button type="button" onClick={() => void toggleStage(change)} className={`w-14 rounded px-1 py-0.5 text-[10px] ${staged ? 'bg-success/15 text-success' : 'bg-surface-3 text-text-3'}`}>{staged ? 'staged' : 'stage'}</button>
            <button type="button" onDoubleClick={() => { const path = toProjectPath(change.path); if (path) void useGoIDEStore.getState().openLocation(path, 1) }} title={toProjectPath(change.path) ? 'Double-click to open in the editor' : 'This change belongs to another folder in the repository'} className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-text-2">{change.path}</button>
            <span className={`text-[10.5px] ${change.conflicted ? 'text-danger' : 'text-text-4'}`}>{changeLabel(change)}</span>
          </div>
        })}
      </div>}

      {tab === 'log' && overview && <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(320px,1fr)_minmax(220px,0.7fr)]">
        <aside className="overflow-auto border-r border-border-1 p-2 text-[11.5px]">
          <div className="mb-1 font-semibold text-text-2">Local</div>{localBranches.map((branch) => <div key={branch.name} className={`flex h-6 items-center gap-1.5 truncate px-1 ${branch.current ? 'text-accent' : 'text-text-3'}`}><GitBranch size={11} />{branch.name}</div>)}
          <div className="mb-1 mt-3 font-semibold text-text-2">Remote</div>{remoteBranches.map((branch) => <div key={branch.name} className="flex h-6 items-center gap-1.5 truncate px-1 text-text-4"><GitFork size={11} />{branch.name}</div>)}
        </aside>
        <GoStudioGitLog commits={overview.commits} selectedHash={selectedHash} onSelect={setSelectedHash} />
        <div className="overflow-auto p-3">{selectedCommit ? <><h4 className="text-[12.5px] font-medium text-text-1">{selectedCommit.message}</h4><p className="mt-2 font-mono text-[10.5px] text-text-4">{selectedCommit.fullHash}</p><p className="mt-2 text-[11.5px] text-text-3">{selectedCommit.author}<br />{selectedCommit.date}</p>{selectedCommit.decorations?.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{selectedCommit.decorations.map((item) => <span key={item} className="gs-badge">{item}</span>)}</div>}</> : <p className="text-[12px] text-text-4">Select a commit to view details.</p>}</div>
      </div>}

      {tab === 'worktrees' && <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-3 text-[11.5px] text-text-4">Worktrees belonging to this repository. Each path can be opened as a separate project and keeps its own IDE session.</p>
        <div className="gs-list">{worktrees.map((worktree) => <div key={worktree.path} className="gs-list-row">
          <GitFork size={14} className="text-accent" /><div className="min-w-0 flex-1"><div className="truncate font-mono text-[11.5px] text-text-1">{worktree.path}</div><div className="text-[10.5px] text-text-4">{worktree.detached ? 'detached HEAD' : worktree.branch || 'no branch'} · {worktree.head.slice(0, 10)}</div></div>
          {worktree.path === repoRoot && <span className="gs-badge text-accent">current repository</span>}
        </div>)}</div>
      </div>}
    </div>
  )
}
