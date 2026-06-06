import { useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowRightLeft,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  GitPullRequestArrow,
  GitPullRequestClosed,
  History,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
} from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { cn } from '@/lib/utils'

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

  const localBranches = useMemo(() => branches.filter((branch) => !branch.remote), [branches])
  const branchChoices = useMemo(() => branches.map((branch) => branch.name).filter(Boolean), [branches])
  const selectedBranch = branchTarget || localBranches.find((branch) => !branch.current)?.name || currentBranch
  const firstStash = stashes[0]?.match(/^stash@\{\d+\}/)?.[0] ?? 'stash@{0}'
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
                <button className={actionClass('danger')} disabled={disabled} onClick={() => runAction(() => GitSync.RemoveRemote(repoPath, remote.name), 'Remote removed.')}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<Archive size={13} />} title="Stash">
          <div className="flex flex-wrap gap-2">
            <button className={actionClass('primary')} disabled={disabled} onClick={() => runAction(() => GitSync.Stash(repoPath), 'Working changes stashed.')}>Save stash</button>
            <button className={actionClass()} disabled={disabled || stashes.length === 0} onClick={() => runAction(() => GitSync.StashPop(repoPath), 'Stash applied.')}>Pop</button>
            <button className={actionClass('danger')} disabled={disabled || stashes.length === 0} onClick={() => runAction(() => GitSync.StashDrop(repoPath, firstStash), 'Stash dropped.')}>Drop</button>
          </div>
          <div className="max-h-24 overflow-y-auto rounded border border-border-1 bg-surface-0 p-2 text-[10px] text-text-3">
            {stashes.length === 0 ? 'No stashes' : stashes.map((stash) => <div key={stash} className="truncate">{stash}</div>)}
          </div>
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
            <button className={actionClass('danger')} disabled={disabled || !selectedFile} onClick={() => runAction(() => GitSync.RemoveFile(repoPath, selectedFile), 'File removed.')}>Remove</button>
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
        </Section>

        <Section icon={<Tag size={13} />} title="Tags">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
            <input value={tagName} onChange={(event) => setTagName(event.target.value)} className={fieldClass()} placeholder="Tag name" />
            <input value={tagRef} onChange={(event) => setTagRef(event.target.value)} className={fieldClass()} placeholder="Ref" />
            <button className={actionClass('primary')} disabled={disabled || !tagName.trim()} onClick={() => runAction(() => GitSync.CreateTag(repoPath, tagName.trim(), tagRef.trim()), 'Tag created.')}>Create</button>
            <button className={actionClass('danger')} disabled={disabled || !tagName.trim()} onClick={() => runAction(() => GitSync.DeleteTag(repoPath, tagName.trim()), 'Tag deleted.')}>Delete</button>
          </div>
        </Section>
      </div>
    </div>
  )
}

function DownloadIcon() {
  return <GitPullRequestArrow size={13} />
}
