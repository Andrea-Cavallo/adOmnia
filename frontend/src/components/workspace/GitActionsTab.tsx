import { useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  Boxes,
  ArrowRightLeft,
  GitBranch,
  GitCommit,
  GitFork,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestClosed,
  History,
  FolderTree,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'
import { GitCollaborationSection } from './git/GitCollaborationSection'
import { GitTerminal } from './git/GitTerminal'

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
}

interface RemoteInfo {
  name: string
  url: string
}

interface ReflogEntry {
  selector: string
  hash: string
  action: string
  when: string
}

interface SubmoduleInfo { path: string; hash: string; state: string }
interface WorktreeInfo { path: string; head: string; branch: string; bare: boolean; detached: boolean }

interface GitActionsTabProps {
  repoPath: string
  currentBranch: string
  changes: FileChange[]
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  stashes: string[]
  loading: boolean
  setRepoPath: (path: string) => void
  runAction: (action: () => Promise<void>, success: string) => Promise<void>
}

function shortBranch(name: string): string {
  return name.replace(/^remotes\//, '').replace(/^origin\//, '')
}

function actionClass(kind: 'primary' | 'quiet' | 'danger' = 'quiet') {
  return cn(
    'inline-flex h-8 items-center justify-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors disabled:opacity-40',
    kind === 'primary' && 'bg-accent text-white hover:bg-accent-light',
    kind === 'quiet' && 'border border-border-2 bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text-1',
    kind === 'danger' && 'border border-error/40 bg-error/10 text-error hover:bg-error/15',
  )
}

function fieldClass() {
  return 'h-8 min-w-0 rounded border border-border-2 bg-surface-2 px-2 text-xs text-text-1 outline-none placeholder:text-text-4 focus:border-accent'
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded border border-border-1 bg-surface-1">
      <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-4">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  )
}

export function GitActionsTab({ repoPath, currentBranch, changes, branches, remotes, stashes, loading, setRepoPath, runAction }: GitActionsTabProps) {
  const [cloneURL, setCloneURL] = useState('')
  const [cloneDest, setCloneDest] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [ignorePattern, setIgnorePattern] = useState('')
  const [branchName, setBranchName] = useState('')
  const [branchTarget, setBranchTarget] = useState('')
  const [remoteName, setRemoteName] = useState('origin')
  const [remoteURL, setRemoteURL] = useState('')
  const [filePath, setFilePath] = useState('')
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [resetRef, setResetRef] = useState('HEAD')
  const [tagName, setTagName] = useState('')
  const [tagRef, setTagRef] = useState('HEAD')
  const [showRef, setShowRef] = useState('HEAD')
  const [showOutput, setShowOutput] = useState('')
  const [upstream, setUpstream] = useState('')
  const [stashOutput, setStashOutput] = useState('')
  const [stashPaths, setStashPaths] = useState<string[]>([])
  const [reflog, setReflog] = useState<ReflogEntry[]>([])
  const [recoveryPoint, setRecoveryPoint] = useState('')
  const [submodules, setSubmodules] = useState<SubmoduleInfo[]>([])
  const [submoduleURL, setSubmoduleURL] = useState('')
  const [submodulePath, setSubmodulePath] = useState('')
  const [submoduleBranch, setSubmoduleBranch] = useState('')
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [worktreePath, setWorktreePath] = useState('')
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [createWorktreeBranch, setCreateWorktreeBranch] = useState(true)
  const [sparsePaths, setSparsePaths] = useState('')
  const [sparseCone, setSparseCone] = useState(true)
  const [advancedError, setAdvancedError] = useState('')

  const localBranches = useMemo(() => branches.filter((branch) => !branch.remote), [branches])
  const branchChoices = useMemo(() => branches.map((branch) => branch.name).filter(Boolean), [branches])
  const selectedBranch = branchTarget || localBranches.find((branch) => !branch.current)?.name || currentBranch
  const selectedFile = filePath || changes[0]?.path || ''

  const disabled = loading || !repoPath

  const runShow = async () => {
    if (!repoPath || !showRef.trim()) return
    setShowOutput('')
    try {
      setShowOutput(await GitSync.Show(repoPath, showRef.trim()))
    } catch (err) {
      setShowOutput(err instanceof Error ? err.message : String(err))
    }
  }

  const stashRef = (line: string) => line.match(/^stash@\{\d+\}/)?.[0] ?? ''
	const toggleStashPath = (path: string) => setStashPaths((current) =>
		current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
	)

  const showStash = async (ref: string) => {
    if (!repoPath || !ref) return
    setStashOutput('')
    try {
      setStashOutput(await GitSync.StashShow(repoPath, ref) || '(empty stash)')
    } catch (err) {
      setStashOutput(err instanceof Error ? err.message : String(err))
    }
  }

  const loadRecoveryPoints = async () => {
    if (!repoPath) return
    try {
      const entries = JSON.parse(await GitSync.Reflog(repoPath, 30)) as ReflogEntry[]
      setReflog(entries)
      setRecoveryPoint(entries.find((entry) => entry.selector !== 'HEAD@{0}')?.selector ?? '')
    } catch (err) {
      setShowOutput(err instanceof Error ? err.message : String(err))
    }
  }

  const restoreRecoveryPoint = (mode: 'soft' | 'mixed' | 'hard') => runAction(async () => {
    const raw = await GitSync.UndoToReflog(repoPath, recoveryPoint, mode)
    const result = JSON.parse(raw) as { success: boolean; error?: string }
    if (!result.success) throw new Error(result.error || 'Could not restore recovery point.')
    await loadRecoveryPoints()
  }, 'Repository restored from reflog.')

  const loadSubmodules = async () => {
    try { setAdvancedError(''); setSubmodules(JSON.parse(await GitSync.ListSubmodules(repoPath)) as SubmoduleInfo[]) }
    catch (e) { setAdvancedError(String(e)) }
  }
  const loadWorktrees = async () => {
    try { setAdvancedError(''); setWorktrees(JSON.parse(await GitSync.ListWorktrees(repoPath)) as WorktreeInfo[]) }
    catch (e) { setAdvancedError(String(e)) }
  }
  const loadSparse = async () => {
    try { setAdvancedError(''); setSparsePaths((JSON.parse(await GitSync.SparseCheckoutList(repoPath)) as string[]).join(', ')) }
    catch (e) { setAdvancedError(String(e)) }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface-0 p-3">
      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        <Section icon={<GitCommit size={13} />} title="Repository">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input value={cloneURL} onChange={(event) => setCloneURL(event.target.value)} className={fieldClass()} placeholder="Remote URL" />
            <input value={cloneDest} onChange={(event) => setCloneDest(event.target.value)} className={fieldClass()} placeholder="Destination folder" />
            <button
              className={actionClass('primary')}
              disabled={loading || !cloneURL.trim() || !cloneDest.trim()}
              onClick={() => runAction(async () => {
                await GitSync.Clone(cloneURL.trim(), cloneDest.trim())
                setRepoPath(cloneDest.trim())
              }, 'Repository cloned.')}
            >
              <DownloadIcon /> Clone
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={actionClass()} disabled={disabled} onClick={() => runAction(() => GitSync.Fetch(repoPath), 'Fetch complete.')}><GitPullRequestArrow size={13} /> Fetch</button>
            <button className={actionClass()} disabled={disabled} onClick={() => runAction(() => GitSync.Pull(repoPath, currentBranch), 'Pull complete.')}><GitPullRequest size={13} /> Pull</button>
            <button className={actionClass('primary')} disabled={disabled} onClick={() => runAction(() => GitSync.Push(repoPath, currentBranch), 'Push complete.')}><Upload size={13} /> Push</button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input value={userName} onChange={(event) => setUserName(event.target.value)} className={fieldClass()} placeholder="Author name" />
            <input value={userEmail} onChange={(event) => setUserEmail(event.target.value)} className={fieldClass()} placeholder="Author email" />
            <button className={actionClass()} disabled={disabled || (!userName.trim() && !userEmail.trim())} onClick={() => runAction(() => GitSync.ConfigureUser(repoPath, userName.trim(), userEmail.trim()), 'Git identity saved.')}>Save identity</button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input value={ignorePattern} onChange={(event) => setIgnorePattern(event.target.value)} className={fieldClass()} placeholder=".gitignore pattern" />
            <button className={actionClass()} disabled={disabled || !ignorePattern.trim()} onClick={() => runAction(() => GitSync.AddIgnorePattern(repoPath, ignorePattern.trim()), 'Ignore pattern added.')}>Ignore</button>
          </div>
        </Section>

        <Section icon={<GitBranch size={13} />} title="Branches">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} className={fieldClass()} placeholder="New branch" />
            <button className={actionClass()} disabled={disabled || !branchName.trim()} onClick={() => runAction(() => GitSync.CreateBranch(repoPath, branchName.trim()), 'Branch created.')}>Create</button>
            <button className={actionClass('primary')} disabled={disabled || !branchName.trim()} onClick={() => runAction(() => GitSync.CreateAndCheckoutBranch(repoPath, branchName.trim()), 'Branch created and checked out.')}>Create + switch</button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <select value={selectedBranch} onChange={(event) => setBranchTarget(event.target.value)} className={fieldClass()}>
              {branchChoices.map((branch) => <option key={branch} value={branch}>{shortBranch(branch)}</option>)}
            </select>
            <button className={actionClass()} disabled={disabled || !selectedBranch} onClick={() => runAction(() => GitSync.CheckoutBranch(repoPath, selectedBranch), 'Branch checked out.')}>Switch</button>
            <button className={actionClass()} disabled={disabled || !selectedBranch} onClick={() => runAction(() => GitSync.MergeBranch(repoPath, selectedBranch), 'Merge complete.')}><GitMerge size={13} /> Merge</button>
            <button className={actionClass()} disabled={disabled || !selectedBranch} onClick={() => runAction(() => GitSync.RebaseBranch(repoPath, selectedBranch), 'Rebase complete.')}><ArrowRightLeft size={13} /> Rebase</button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input value={upstream} onChange={(event) => setUpstream(event.target.value)} className={fieldClass()} placeholder="Upstream e.g. origin/main" />
            <button className={actionClass()} disabled={disabled || !selectedBranch || !upstream.trim()} onClick={() => runAction(() => GitSync.SetUpstream(repoPath, selectedBranch, upstream.trim()), 'Upstream set.')}>Set upstream</button>
            <button
              className={actionClass('danger')}
              disabled={disabled || !selectedBranch}
              onClick={() => {
                if (window.confirm(`Delete local branch "${shortBranch(selectedBranch)}"?`)) {
                  void runAction(async () => {
                    try {
                      await GitSync.DeleteLocalBranch(repoPath, selectedBranch, false)
                    } catch {
                      if (window.confirm(`"${shortBranch(selectedBranch)}" may not be fully merged. Force delete?`)) {
                        await GitSync.DeleteLocalBranch(repoPath, selectedBranch, true)
                      } else {
                        throw new Error('Deletion cancelled.')
                      }
                    }
                  }, 'Branch deleted.')
                }
              }}
            >
              Delete branch
            </button>
          </div>
        </Section>

        <Section icon={<GitPullRequestClosed size={13} />} title="Remotes">
          <div className="grid gap-2 md:grid-cols-[120px_1fr_auto]">
            <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} className={fieldClass()} placeholder="Name" />
            <input value={remoteURL} onChange={(event) => setRemoteURL(event.target.value)} className={fieldClass()} placeholder="Remote URL" />
            <button className={actionClass('primary')} disabled={disabled || !remoteName.trim() || !remoteURL.trim()} onClick={() => runAction(() => GitSync.AddRemote(repoPath, remoteName.trim(), remoteURL.trim()), 'Remote saved.')}>Save remote</button>
          </div>
          <div className="space-y-1">
            {remotes.map((remote) => (
              <div key={remote.name} className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5">
                <span className="w-20 truncate text-xs font-medium text-text-1">{remote.name}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-text-4">{remote.url}</span>
                <button className={actionClass('danger')} disabled={disabled} onClick={() => { if (window.confirm(`Remove remote "${remote.name}"?`)) void runAction(() => GitSync.RemoveRemote(repoPath, remote.name), 'Remote removed.') }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </Section>

        <GitCollaborationSection repoPath={repoPath} currentBranch={currentBranch} branches={branches} remotes={remotes} loading={loading} />

        <GitTerminal repoPath={repoPath} disabled={disabled} onRepositoryChanged={() => runAction(async () => undefined, 'Repository refreshed after terminal command.')} />

        <Section icon={<Archive size={13} />} title="Stash">
          <div className="flex flex-wrap gap-2">
            <button className={actionClass('primary')} disabled={disabled} onClick={() => runAction(() => GitSync.Stash(repoPath), 'Working changes stashed.')}>Save stash</button>
            <button
				className={actionClass()}
				disabled={disabled || stashPaths.length === 0}
				onClick={() => runAction(async () => {
					await GitSync.StashPaths(repoPath, stashPaths)
					setStashPaths([])
				}, `${stashPaths.length} selected file${stashPaths.length === 1 ? '' : 's'} stashed.`)}
			>
				Stash selected ({stashPaths.length})
			</button>
            <button className={actionClass()} disabled={disabled || stashes.length === 0} onClick={() => runAction(() => GitSync.StashPop(repoPath), 'Stash popped.')}>Pop latest</button>
          </div>
		  {changes.length > 0 && (
			<div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border-1 bg-surface-0 p-1.5">
				{changes.map((change) => (
					<label key={`stash-${change.path}`} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[10px] text-text-2 hover:bg-surface-2">
						<input type="checkbox" checked={stashPaths.includes(change.path)} onChange={() => toggleStashPath(change.path)} />
						<span className="truncate font-mono" title={change.path}>{change.path}</span>
					</label>
				))}
			</div>
		  )}
          <div className="space-y-1.5">
            {stashes.length === 0 ? (
              <div className="rounded border border-dashed border-border-2 p-2 text-center text-[10px] text-text-4">No stashes</div>
            ) : stashes.map((stash) => {
              const ref = stashRef(stash)
              return (
                <div key={stash} className="rounded border border-border-1 bg-surface-0 p-1.5">
                  <div className="truncate text-[10px] text-text-2" title={stash}>{stash}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button className={actionClass()} disabled={disabled || !ref} onClick={() => runAction(() => GitSync.StashApply(repoPath, ref), 'Stash applied.')}>Apply</button>
                    <button className={actionClass()} disabled={disabled || !ref} onClick={() => void showStash(ref)}>Show</button>
                    <button className={actionClass('danger')} disabled={disabled || !ref} onClick={() => { if (window.confirm(`Drop ${ref}? This discards the stashed changes.`)) void runAction(() => GitSync.StashDrop(repoPath, ref), 'Stash dropped.') }}>Drop</button>
                  </div>
                </div>
              )
            })}
          </div>
          {stashOutput && <pre className="max-h-44 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-2">{stashOutput}</pre>}
        </Section>

        <Section icon={<RotateCcw size={13} />} title="Files">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <input value={selectedFile} onChange={(event) => setFilePath(event.target.value)} className={fieldClass()} placeholder="File path" />
            <button className={actionClass()} disabled={disabled || !selectedFile} onClick={() => runAction(() => GitSync.StageFile(repoPath, selectedFile), 'File staged.')}>Stage</button>
            <button className={actionClass()} disabled={disabled || !selectedFile} onClick={() => runAction(() => GitSync.UnstageFile(repoPath, selectedFile), 'File unstaged.')}>Unstage</button>
            <button className={actionClass('danger')} disabled={disabled || !selectedFile} onClick={() => runAction(() => GitSync.RestoreFile(repoPath, selectedFile), 'File restored.')}>Restore</button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
            <input value={moveFrom} onChange={(event) => setMoveFrom(event.target.value)} className={fieldClass()} placeholder="Move from" />
            <input value={moveTo} onChange={(event) => setMoveTo(event.target.value)} className={fieldClass()} placeholder="Move to" />
            <button className={actionClass()} disabled={disabled || !moveFrom.trim() || !moveTo.trim()} onClick={() => runAction(() => GitSync.MoveFile(repoPath, moveFrom.trim(), moveTo.trim()), 'File moved.')}>Move</button>
            <button className={actionClass('danger')} disabled={disabled || !selectedFile} onClick={() => { if (window.confirm(`Remove "${selectedFile}" from the repository?`)) void runAction(() => GitSync.RemoveFile(repoPath, selectedFile), 'File removed.') }}>Remove</button>
          </div>
        </Section>

        <Section icon={<History size={13} />} title="History">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input value={showRef} onChange={(event) => setShowRef(event.target.value)} className={fieldClass()} placeholder="Commit, tag, ref" />
            <button className={actionClass()} disabled={disabled || !showRef.trim()} onClick={() => void runShow()}>Show</button>
          </div>
          {showOutput && <pre className="max-h-44 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-2">{showOutput}</pre>}
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <input value={resetRef} onChange={(event) => setResetRef(event.target.value)} className={fieldClass()} placeholder="Reset target" />
            <button
              className={actionClass('danger')}
              disabled={disabled || !resetRef.trim()}
              onClick={() => {
                if (window.confirm(`Hard reset working tree to ${resetRef.trim()}?`)) {
                  void runAction(() => GitSync.ResetHard(repoPath, resetRef.trim()), 'Hard reset complete.')
                }
              }}
            >
              Hard reset
            </button>
          </div>
          <div className="border-t border-border-1 pt-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Undo from reflog</span>
              <button className={actionClass()} disabled={disabled} onClick={() => void loadRecoveryPoints()}>Load recovery points</button>
            </div>
            {reflog.length > 0 && (
              <>
                <select value={recoveryPoint} onChange={(event) => setRecoveryPoint(event.target.value)} className={`${fieldClass()} w-full`}>
                  {reflog.filter((entry) => entry.selector !== 'HEAD@{0}').map((entry) => (
                    <option key={`${entry.selector}-${entry.hash}`} value={entry.selector}>{entry.selector} · {entry.hash.slice(0, 7)} · {entry.action} · {entry.when}</option>
                  ))}
                </select>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button className={actionClass()} disabled={!recoveryPoint || loading} onClick={() => void restoreRecoveryPoint('soft')}>Restore · keep staged</button>
                  <button className={actionClass()} disabled={!recoveryPoint || loading} onClick={() => void restoreRecoveryPoint('mixed')}>Restore · keep files</button>
                  <button
                    className={actionClass('danger')}
                    disabled={!recoveryPoint || loading}
                    onClick={() => {
                      if (window.confirm(`Restore exactly to ${recoveryPoint}? Uncommitted changes will be discarded.`)) void restoreRecoveryPoint('hard')
                    }}
                  >Restore exact</button>
                </div>
              </>
            )}
          </div>
        </Section>

        <Section icon={<Tag size={13} />} title="Tags">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
            <input value={tagName} onChange={(event) => setTagName(event.target.value)} className={fieldClass()} placeholder="Tag name" />
            <input value={tagRef} onChange={(event) => setTagRef(event.target.value)} className={fieldClass()} placeholder="Ref" />
            <button className={actionClass('primary')} disabled={disabled || !tagName.trim()} onClick={() => runAction(() => GitSync.CreateTag(repoPath, tagName.trim(), tagRef.trim()), 'Tag created.')}>Create</button>
            <button className={actionClass('danger')} disabled={disabled || !tagName.trim()} onClick={() => runAction(() => GitSync.DeleteTag(repoPath, tagName.trim()), 'Tag deleted.')}>Delete</button>
          </div>
        </Section>

        <Section icon={<Boxes size={13} />} title="Submodules">
          {advancedError && <div className="rounded border border-error/30 bg-error/10 p-2 text-[10px] text-error">{advancedError}</div>}
          <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_.7fr_auto]">
            <input value={submoduleURL} onChange={(e) => setSubmoduleURL(e.target.value)} className={fieldClass()} placeholder="Repository URL or local path" />
            <input value={submodulePath} onChange={(e) => setSubmodulePath(e.target.value)} className={fieldClass()} placeholder="vendor/module" />
            <input value={submoduleBranch} onChange={(e) => setSubmoduleBranch(e.target.value)} className={fieldClass()} placeholder="Branch (optional)" />
            <button className={actionClass('primary')} disabled={disabled || !submoduleURL.trim() || !submodulePath.trim()} onClick={() => runAction(async () => { await GitSync.AddSubmodule(repoPath, submoduleURL.trim(), submodulePath.trim(), submoduleBranch.trim()); await loadSubmodules() }, 'Submodule added.')}>Add</button>
          </div>
          <div className="flex gap-2"><button className={actionClass()} disabled={disabled} onClick={() => void loadSubmodules()}>Refresh</button><button className={actionClass()} disabled={disabled} onClick={() => runAction(async () => { await GitSync.UpdateSubmodules(repoPath, ''); await loadSubmodules() }, 'Submodules updated.')}>Init/update all</button></div>
          <div className="space-y-1">
            {submodules.map((item) => <div key={item.path} className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5"><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-2">{item.path}</span><span className="text-[10px] text-text-4">{item.state} · {item.hash.slice(0, 7)}</span><button className={actionClass()} onClick={() => runAction(async () => { await GitSync.UpdateSubmodules(repoPath, item.path); await loadSubmodules() }, 'Submodule updated.')}>Update</button><button className={actionClass('danger')} onClick={() => { if (window.confirm(`Remove submodule ${item.path} from this repository?`)) void runAction(async () => { await GitSync.RemoveSubmodule(repoPath, item.path); await loadSubmodules() }, 'Submodule removed.') }}>Remove</button></div>)}
          </div>
        </Section>

        <Section icon={<GitFork size={13} />} title="Worktrees">
          <div className="grid gap-2 md:grid-cols-[1.3fr_1fr_auto_auto]">
            <input value={worktreePath} onChange={(e) => setWorktreePath(e.target.value)} className={fieldClass()} placeholder="Worktree destination" />
            <input value={worktreeBranch} onChange={(e) => setWorktreeBranch(e.target.value)} className={fieldClass()} placeholder="Branch" />
            <label className="flex items-center gap-1.5 text-[10px] text-text-2"><input type="checkbox" checked={createWorktreeBranch} onChange={(e) => setCreateWorktreeBranch(e.target.checked)} /> New branch</label>
            <button className={actionClass('primary')} disabled={disabled || !worktreePath.trim() || (createWorktreeBranch && !worktreeBranch.trim())} onClick={() => runAction(async () => { await GitSync.AddWorktree(repoPath, worktreePath.trim(), worktreeBranch.trim(), createWorktreeBranch); await loadWorktrees() }, 'Worktree added.')}>Add</button>
          </div>
          <button className={actionClass()} disabled={disabled} onClick={() => void loadWorktrees()}>Refresh</button>
          <div className="space-y-1">{worktrees.map((item) => <div key={item.path} className="flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-[10px] text-text-2" title={item.path}>{item.path}</span><span className="font-mono text-[10px] text-text-4">{item.branch || 'detached'} · {item.head.slice(0, 7)}</span>{item.path !== repoPath && <button className={actionClass('danger')} onClick={() => { if (window.confirm(`Remove worktree ${item.path}?`)) void runAction(async () => { await GitSync.RemoveWorktree(repoPath, item.path, false); await loadWorktrees() }, 'Worktree removed.') }}>Remove</button>}</div>)}</div>
        </Section>

        <Section icon={<FolderTree size={13} />} title="Sparse checkout">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <input value={sparsePaths} onChange={(e) => setSparsePaths(e.target.value)} className={fieldClass()} placeholder="Paths separated by commas, e.g. frontend, docs" />
            <label className="flex items-center gap-1.5 text-[10px] text-text-2"><input type="checkbox" checked={sparseCone} onChange={(e) => setSparseCone(e.target.checked)} /> Cone mode</label>
            <button className={actionClass('primary')} disabled={disabled || !sparsePaths.trim()} onClick={() => runAction(() => GitSync.SetSparseCheckout(repoPath, sparsePaths.split(/[,\n]/).map((path) => path.trim()).filter(Boolean), sparseCone), 'Sparse checkout applied.')}>Apply</button>
          </div>
          <div className="flex gap-2"><button className={actionClass()} disabled={disabled} onClick={() => void loadSparse()}>Load current</button><button className={actionClass('danger')} disabled={disabled} onClick={() => { if (window.confirm('Disable sparse checkout and restore the full working tree?')) void runAction(async () => { await GitSync.DisableSparseCheckout(repoPath); setSparsePaths('') }, 'Sparse checkout disabled.') }}>Disable</button></div>
        </Section>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return <GitPullRequestArrow size={13} />
}
