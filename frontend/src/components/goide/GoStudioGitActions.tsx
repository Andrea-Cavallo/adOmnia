import { useState } from 'react'
import { Archive, Check, GitBranch, GitFork, GitMerge, Plus, Trash2 } from 'lucide-react'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { confirm } from '@/lib/confirmDialog'
import { branchNameError } from '@/lib/git/branchName'
import { shortBranch, type BranchInfo } from '@/lib/git/overview'
import type { FileChange } from '@/lib/git/types'

/** Runs a repository mutation, then refreshes; errors surface in the panel banner. */
export type GitRun = (action: () => Promise<unknown>) => Promise<void>

interface BranchesProps {
  repoRoot: string
  branches: BranchInfo[]
  busy: boolean
  run: GitRun
}

/** Branch list with the V1 operations: switch, create, merge into current, delete. Rebase stays parked. */
export function GoStudioGitBranches({ repoRoot, branches, busy, run }: BranchesProps) {
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')
  const local = branches.filter((branch) => !branch.remote)
  const remote = branches.filter((branch) => branch.remote)
  const current = local.find((branch) => branch.current)?.name ?? ''

  const create = () => {
    const invalid = branchNameError(name)
    if (invalid) return setFormError(invalid)
    setFormError('')
    void run(() => GitSync.CreateAndCheckoutBranch(repoRoot, name.trim())).then(() => setName(''))
  }
  const merge = async (branch: string) => {
    if (!await confirm({ title: `Merge ${branch} into ${current}?`, message: `Command: git merge ${branch}\n\nConflicts are listed in the Git tab, where you can resolve or abort.`, confirmLabel: 'Merge' })) return
    void run(() => GitSync.MergeBranch(repoRoot, branch))
  }
  const remove = async (branch: string) => {
    if (!await confirm({ title: `Delete branch ${branch}?`, message: `Command: git branch -d ${branch}\n\nGit refuses when the branch is not fully merged.`, confirmLabel: 'Delete branch' })) return
    void run(() => GitSync.DeleteLocalBranch(repoRoot, branch, false))
  }

  return (
    <aside aria-label="Branches" className="gs-git-branches flex min-h-0 flex-col overflow-auto border-r border-border-1 p-2 text-[11.5px]">
      <form className="mb-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); create() }}>
        <input aria-label="New branch name" value={name} onChange={(event) => { setName(event.target.value); setFormError('') }} placeholder="New branch…" className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-1 px-2 text-[11px] text-text-1 outline-none focus:border-accent" />
        <button type="submit" disabled={busy || !name.trim()} title="Create and switch to the new branch" aria-label="Create branch" className="go-studio-icon-button h-7 w-7"><Plus size={13} /></button>
      </form>
      {formError && <p role="alert" className="mb-1 text-[10.5px] text-danger">{formError}</p>}
      <div className="gs-git-branch-heading"><span>Local</span><span>{local.length}</span></div>
      {local.map((branch) => (
        <div key={branch.name} className={`gs-git-branch-row group flex h-8 items-center gap-1 px-2 ${branch.current ? 'is-current text-text-1' : 'text-text-3'}`}>
          <button type="button" disabled={busy || branch.current} onClick={() => void run(() => GitSync.CheckoutBranch(repoRoot, branch.name))} title={branch.current ? 'Current branch' : `Switch to ${branch.name}`} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left hover:text-text-1">
            <GitBranch size={11} className="shrink-0" /><span className="truncate">{branch.name}</span>{branch.current && <Check size={11} className="shrink-0" />}
          </button>
          {!branch.current && <>
            <button type="button" disabled={busy} onClick={() => void merge(branch.name)} title={`Merge ${branch.name} into ${current}`} aria-label={`Merge ${branch.name} into current branch`} className="shrink-0 rounded p-0.5 opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100"><GitMerge size={11} /></button>
            <button type="button" disabled={busy} onClick={() => void remove(branch.name)} title="Delete branch" aria-label={`Delete branch ${branch.name}`} className="shrink-0 rounded p-0.5 opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"><Trash2 size={11} /></button>
          </>}
        </div>
      ))}
      <div className="gs-git-branch-heading mt-3"><span>Remote</span><span>{remote.length}</span></div>
      {remote.map((branch) => (
        <button key={branch.name} type="button" disabled={busy} onClick={() => void run(() => GitSync.CheckoutRemoteBranch(repoRoot, branch.name))} title={`Check out ${shortBranch(branch.name)} as a tracking branch`} className="gs-git-branch-row flex h-8 w-full items-center gap-1.5 truncate px-2 text-left text-text-4 hover:text-text-1">
          <GitFork size={11} className="shrink-0" /><span className="truncate">{branch.name}</span>
        </button>
      ))}
    </aside>
  )
}

interface ChangesActionsProps {
  repoRoot: string
  changes: FileChange[]
  conflicts: FileChange[]
  stashes: string[]
  busy: boolean
  run: GitRun
  onResolve: () => void
}

/** Stash controls and the merge-conflict list shown above the working-tree changes. */
export function GoStudioGitChangesActions({ repoRoot, changes, conflicts, stashes, busy, run, onResolve }: ChangesActionsProps) {
  return (
    <div className="border-b border-border-1">
      {conflicts.length > 0 && (
        <section aria-label="Merge conflicts" className="border-b border-warning/30 bg-warning/10 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] font-semibold text-warning">
            Merge conflicts ({conflicts.length})
            <button type="button" onClick={onResolve} className="go-studio-icon-button ml-auto h-6 px-2 text-[11px]">Resolve…</button>
            <button type="button" disabled={busy} onClick={() => void run(() => GitSync.AbortIntegration(repoRoot))} className="go-studio-icon-button h-6 px-2 text-[11px] text-danger">Abort</button>
          </div>
          {conflicts.map((change) => (
            <div key={change.path} className="flex h-7 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-1">{change.path}</span>
              <button type="button" disabled={busy} onClick={() => void run(() => GitSync.CheckoutConflictSide(repoRoot, change.path, 'ours'))} className="rounded border border-border-2 px-1.5 text-[10.5px] text-text-2 hover:text-text-1">Ours</button>
              <button type="button" disabled={busy} onClick={() => void run(() => GitSync.CheckoutConflictSide(repoRoot, change.path, 'theirs'))} className="rounded border border-border-2 px-1.5 text-[10.5px] text-text-2 hover:text-text-1">Theirs</button>
              <button type="button" disabled={busy} onClick={() => void run(() => GitSync.StageFile(repoRoot, change.path))} className="rounded border border-accent/50 px-1.5 text-[10.5px] text-accent">Mark resolved</button>
            </div>
          ))}
        </section>
      )}
      <div className="flex h-8 items-center gap-2 px-3 text-[11px] text-text-3">
        <Archive size={12} />
        <button type="button" disabled={busy || changes.length === 0} onClick={() => void run(() => GitSync.Stash(repoRoot))} className="go-studio-icon-button h-6 px-2 text-[11px]" title="Stash working changes">Stash</button>
        <button type="button" disabled={busy || stashes.length === 0} onClick={() => void run(() => GitSync.StashPop(repoRoot))} className="go-studio-icon-button h-6 px-2 text-[11px]" title="Apply the latest stash and drop it">Pop</button>
        <span className="truncate text-text-4">{stashes.length === 0 ? 'No stashes' : `${stashes.length} stash${stashes.length === 1 ? '' : 'es'} · ${stashes[0]}`}</span>
      </div>
    </div>
  )
}
