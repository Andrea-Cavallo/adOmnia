import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, GitBranch, GitFork, Loader2, RefreshCw, Scissors } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import type { GoIDESession } from '@/lib/goide-api'
import { pullGoIDERepository, pushGoIDERepository } from '@/lib/goide-vcs-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import type { FileChange as GitChange } from '@/lib/git/types'
import { gitPathInProject } from './goStudioGitPaths'
import { GoStudioGitLog } from './GoStudioGitLog'
import { changeLabel, isStagedChange, parseGitOverview, parseJSON, type GitOverview } from '@/lib/git/overview'
import { GitCollaborationSection } from '@/components/workspace/git/GitCollaborationSection'
import { GoStudioGitBranches, GoStudioGitChangesActions } from './GoStudioGitActions'
import { HunkStageDialog } from '@/components/workspace/git/HunkStageDialog'
import type { GoStudioCommandId } from './goStudioCommands'

interface GitWorktree { path: string; head: string; branch: string; bare: boolean; detached: boolean }

type Tab = 'git' | 'log' | 'worktrees' | 'prs'

const TAB_LABEL: Record<Tab, string> = { git: 'Git', log: 'Log', worktrees: 'Worktrees', prs: 'Pull requests' }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Git workbench scoped to one IDE session. It never reads the global Git Studio repository choice. */
export function GoStudioGitPanel({ session, onCommand }: { session: GoIDESession; onCommand?: (id: GoStudioCommandId) => void }) {
  const sessionId = session.id
  const vcsStatus = useGoIDEVCSStore((state) => state.status[sessionId])
  const [tab, setTab] = useState<Tab>('log')
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [selectedHash, setSelectedHash] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hunkStage, setHunkStage] = useState<{ path: string; mode: 'stage' | 'unstage' } | null>(null)
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
      const next = parseGitOverview(rawOverview)
      setOverview(next)
      setWorktrees(parseJSON<GitWorktree[]>(rawWorktrees, []))
      setSelectedHash((value) => value && next.commits.some((commit) => commit.fullHash === value) ? value : next.commits[0]?.fullHash ?? '')
    } catch (reason) { if (version === refreshVersion.current) setError(errorText(reason)) } finally { if (version === refreshVersion.current) setLoading(false) }
  }, [repoRoot, sessionId])

  useEffect(() => { setOverview(null); void refresh(); return () => { refreshVersion.current++ } }, [refresh])
  const selectedCommit = useMemo(() => overview?.commits.find((commit) => commit.fullHash === selectedHash) ?? null, [overview, selectedHash])
  const toProjectPath = (path: string): string | null => gitPathInProject(session.project.realPath, repoRoot, path)

  const sync = async (kind: 'pull' | 'push') => {
    setLoading(true); setError('')
    try {
      if (kind === 'pull') await pullGoIDERepository(sessionId); else await pushGoIDERepository(sessionId)
      await refresh()
    } catch (reason) { setError(errorText(reason)); setLoading(false) }
  }
  /** Mutations on the repository: errors go to the banner, success reloads the overview. */
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setLoading(true); setError('')
    let failure = ''
    try { await action() } catch (reason) { failure = errorText(reason) }
    await refresh()
    if (failure) setError(failure)
    void useGoIDEStore.getState().checkActiveDocument()
  }, [refresh])
  const openRemote = async () => {
    const url = await GitSync.RemoteWebURL(repoRoot)
    if (!url) return setError('No web URL could be derived from the remotes.')
    if (!url.startsWith('https://')) return setError('The remote does not use an https web address.')
    const { BrowserOpenURL } = await import('@/wailsjs/runtime/runtime')
    BrowserOpenURL(url)
  }
  const toggleStage = async (change: GitChange) => {
    const staged = isStagedChange(change)
    try {
      if (staged) await GitSync.UnstageFile(repoRoot, change.path); else await GitSync.StageFile(repoRoot, change.path)
      await refresh()
    } catch (reason) { setError(errorText(reason)) }
  }

  if (!vcsStatus?.available) return <div className="grid h-full place-items-center p-6 text-center text-[12px] text-text-4"><div><GitBranch size={24} className="mx-auto mb-2 opacity-60" /><p>This project is not inside a Git repository.</p></div></div>

  return (
    <div className="gs-git-panel flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border-1 px-2">
        {(['git', 'log', 'worktrees', 'prs'] as const).map((id) => <button key={id} type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-8 border-b-2 px-3 text-[12px] font-medium capitalize ${tab === id ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1'}`}>{TAB_LABEL[id]}</button>)}
        <select aria-label="Git repository" title={repoRoot} value={repoRoot} disabled={loading} onChange={(event) => { setLoading(true); void useGoIDEVCSStore.getState().selectRepository(sessionId, event.target.value).catch((reason) => { setError(errorText(reason)); setLoading(false) }) }} className="ml-2 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 py-1 font-mono text-[10.5px] text-text-2">
          {repositories.map((root) => <option key={root} value={root}>{root}</option>)}
        </select>
        <span className="text-[11px] text-text-3">{overview?.status.branch || vcsStatus.branch}</span>
        {(overview?.status.aheadCount ?? vcsStatus.ahead) > 0 && <span className="flex items-center gap-0.5 text-[10.5px] text-success"><ArrowUp size={11} />{overview?.status.aheadCount ?? vcsStatus.ahead}</span>}
        {(overview?.status.behindCount ?? vcsStatus.behind) > 0 && <span className="flex items-center gap-0.5 text-[10.5px] text-warning"><ArrowDown size={11} />{overview?.status.behindCount ?? vcsStatus.behind}</span>}
        <button type="button" onClick={() => void sync('pull')} disabled={loading} className="go-studio-icon-button h-7 px-2 text-[11px]" title="Pull with rebase and autostash" aria-label="Pull with rebase and autostash"><ArrowDown size={12} /> Pull</button>
        <button type="button" onClick={() => void sync('push')} disabled={loading} className="go-studio-icon-button h-7 px-2 text-[11px]" title="Push current branch" aria-label="Push current branch"><ArrowUp size={12} /> Push</button>
        <button type="button" onClick={() => void openRemote()} disabled={loading || !overview?.remotes.length} className="go-studio-icon-button h-7 w-7" title="Open the repository on its remote host" aria-label="Open on remote"><ExternalLink size={13} /></button>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="go-studio-icon-button h-7 w-7" title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <div role="alert" className="border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">{error}</div>}
      {loading && !overview && <div className="grid flex-1 place-items-center text-text-4"><Loader2 size={18} className="animate-spin" /></div>}

      {tab === 'git' && overview && <div className="min-h-0 flex-1 overflow-auto">
        <GoStudioGitChangesActions repoRoot={repoRoot} changes={overview.changes} conflicts={overview.conflicts} stashes={overview.stashes} busy={loading} run={run} onResolve={() => onCommand?.('vcs.resolveConflicts')} />
        {overview.changes.length === 0 ? <p className="p-4 text-[12px] text-text-4">Working tree clean.</p> : overview.changes.map((change) => {
          const staged = isStagedChange(change)
          return <div key={change.path} className="flex h-8 items-center gap-2 border-b border-border-1/60 px-3 hover:bg-surface-2/60">
            <button type="button" onClick={() => void toggleStage(change)} className={`w-14 rounded px-1 py-0.5 text-[10px] ${staged ? 'bg-success/15 text-success' : 'bg-surface-3 text-text-3'}`}>{staged ? 'staged' : 'stage'}</button>
            <button type="button" onDoubleClick={() => { const path = toProjectPath(change.path); if (path) void useGoIDEStore.getState().openLocation(path, 1) }} title={toProjectPath(change.path) ? 'Double-click to open in the editor' : 'This change belongs to another folder in the repository'} className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-text-2">{change.path}</button>
            <span className={`text-[10.5px] ${change.conflicted ? 'text-danger' : 'text-text-4'}`}>{changeLabel(change)}</span>
            <button type="button" onClick={() => setHunkStage({ path: change.path, mode: staged ? 'unstage' : 'stage' })} title={`Stage or unstage single hunks and lines of ${change.path}`} aria-label={`Hunks of ${change.path}`} className="go-studio-icon-button h-6 w-6 shrink-0"><Scissors size={11} /></button>
          </div>
        })}
        {hunkStage && (
          <HunkStageDialog
            repoPath={repoRoot}
            path={hunkStage.path}
            mode={hunkStage.mode}
            onDone={() => { void refresh() }}
            onClose={() => setHunkStage(null)}
          />
        )}
      </div>}

      {tab === 'log' && overview && <div className="gs-git-log-layout">
        <GoStudioGitBranches repoRoot={repoRoot} branches={overview.branches} busy={loading} run={run} />
        <GoStudioGitLog commits={overview.commits} selectedHash={selectedHash} onSelect={setSelectedHash} />
        <aside className="gs-git-commit-detail" aria-label="Commit details"><div className="gs-git-detail-heading">Commit details</div>{selectedCommit ? <div className="gs-git-detail-body"><h4>{selectedCommit.message}</h4><div className="gs-git-detail-avatar" aria-hidden="true">{selectedCommit.author.slice(0, 2).toUpperCase()}</div><p className="text-[12px] text-text-2">{selectedCommit.author}</p><p className="mt-1 text-[11px] text-text-4">{selectedCommit.date}</p><dl className="gs-git-detail-metadata"><dt>Commit</dt><dd>{selectedCommit.fullHash}</dd><dt>Parents</dt><dd>{selectedCommit.parents.length ? selectedCommit.parents.map((parent) => <button type="button" key={parent} disabled={!overview.commits.some((commit) => commit.fullHash === parent)} onClick={() => setSelectedHash(parent)} title={parent}>{parent.slice(0, 8)}</button>) : '—'}</dd></dl>{selectedCommit.decorations?.length > 0 && <div className="mt-4 flex flex-wrap gap-1">{selectedCommit.decorations.map((item) => <span key={item} className="gs-badge">{item}</span>)}</div>}</div> : <p className="p-4 text-[12px] text-text-4">Select a commit to view details.</p>}</aside>
      </div>}

      {tab === 'prs' && overview && <div className="min-h-0 flex-1 overflow-auto">
        <GitCollaborationSection repoPath={repoRoot} currentBranch={overview.status.branch} branches={overview.branches} remotes={overview.remotes} loading={loading} />
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
