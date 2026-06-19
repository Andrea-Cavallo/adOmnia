import { useEffect, useState } from 'react'
import * as svc from '@/lib/git/gitService'
import * as GitSync from '@/wailsjs/go/main/GitSync'
import { buildCommitMenu } from '@/lib/git/commitMenuModel'
import { runAiCommitAnalysis, aiActionTitle, type AiActionId } from '@/lib/git/aiCommitAnalysis'
import { EMPTY_TREE_REF, type CommitInfo, type CommitMeta, type OpResult, type RebasePlan, type RepoState } from '@/lib/git/types'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { DiffModal } from '@/components/response/DiffView'
import { CompareView } from './CompareView'
import { ConflictResolverDialog } from './ConflictResolverDialog'
import { InteractiveRebaseDialog } from './InteractiveRebaseDialog'
import { BisectPanel } from './BisectPanel'
import {
  CheckoutCommitDialog, CherryPickDialog, CreateBranchDialog, CreateTagDialog,
  PromptDialog, ResetDialog, RestoreFilePreviewDialog, RevertDialog, TextResultDialog,
} from './dialogs'

export interface CommitChangedFile {
  status: string
  path: string
  oldPath?: string
}

export interface CommitMenuRequest { commit: CommitInfo; x: number; y: number }
export interface FileMenuRequest { file: CommitChangedFile; commit: CommitInfo; x: number; y: number }

interface GitGraphActionsProps {
  repoPath: string
  commits: CommitInfo[]
  selectedHashes: string[]
  currentBranch: string
  hasRemote: boolean
  commitMenu: CommitMenuRequest | null
  fileMenu: FileMenuRequest | null
  onCloseMenus: () => void
  onRefresh: () => void
  setInfo: (s: string) => void
  setError: (s: string) => void
}

type Dialog =
  | { kind: 'branch'; ref: string; suggested: string }
  | { kind: 'tag'; ref: string }
  | { kind: 'checkout'; ref: string }
  | { kind: 'reset'; ref: string; mode: 'soft' | 'mixed' | 'hard'; force?: boolean }
  | { kind: 'cherryPick'; shas: string[] }
  | { kind: 'revert'; sha: string; isMerge: boolean; parents: string[]; message: string }
  | { kind: 'restore'; ref: string; path: string; content: string; refLabel: string; stage: boolean }
  | { kind: 'prompt'; title: string; label: string; placeholder?: string; initial?: string; onValue: (v: string) => void }
  | { kind: 'text'; title: string; text: string; loading: boolean }
  | null

function slug(message: string): string {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function openExternal(url: string) {
  if (!url) return
  import('@/wailsjs/runtime/runtime')
    .then(({ BrowserOpenURL }) => BrowserOpenURL(url))
    .catch(() => window.open(url, '_blank'))
}

export function GitGraphActions(props: GitGraphActionsProps) {
  const { repoPath, commits, selectedHashes, currentBranch, hasRemote, commitMenu, fileMenu, onCloseMenus, onRefresh, setInfo, setError } = props

  const [meta, setMeta] = useState<CommitMeta | null>(null)
  const [repoState, setRepoState] = useState<RepoState | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [compare, setCompare] = useState<{ refA: string; refB: string; title: string } | null>(null)
  const [conflict, setConflict] = useState<{ operation: string; conflicts: string[] } | null>(null)
  const [rebasePlan, setRebasePlan] = useState<RebasePlan | null>(null)
  const [bisect, setBisect] = useState<{ bad: string } | null>(null)
  const [fileDiff, setFileDiff] = useState<{ title: string; left: string; right: string; leftLabel: string; rightLabel: string } | null>(null)

  // Load metadata for the right-clicked commit so the menu reflects real state.
  useEffect(() => {
    if (!commitMenu || selectedHashes.length > 1) { setMeta(null); return }
    let cancelled = false
    setMeta(null)
    const ref = commitMenu.commit.fullHash || commitMenu.commit.hash
    Promise.all([svc.getCommitMeta(repoPath, ref), svc.getRepoState(repoPath)])
      .then(([m, s]) => { if (!cancelled) { setMeta(m); setRepoState(s) } })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [commitMenu, repoPath, selectedHashes.length, setError])

  const closeDialog = () => setDialog(null)

  // Run an OpResult-returning action: route conflicts to the resolver, refresh on success.
  const runOp = async (p: Promise<OpResult>, successMsg: string) => {
    setBusy(true)
    setError('')
    try {
      const res = await p
      if (res.code === 'conflict') {
        setConflict({ operation: res.state.operation || 'merge', conflicts: res.conflicts.map((c) => c.path) })
        closeDialog()
      } else if (res.success) {
        setInfo(successMsg)
        closeDialog()
        onRefresh()
      } else {
        setError(res.error || 'Operation failed.')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setInfo(`${label} copied.`) } catch { setError('Clipboard unavailable.') }
  }

  // Ordered selection (oldest → newest) for multi-commit operations.
  const orderedSelection = (): string[] => {
    const order = commits.map((c) => c.fullHash || c.hash)
    return order.filter((h) => selectedHashes.includes(h) || selectedHashes.includes(h.slice(0, 7))).reverse()
  }

  const openAi = async (action: AiActionId, commit: CommitInfo) => {
    const full = commit.fullHash || commit.hash
    setDialog({ kind: 'text', title: aiActionTitle(action), text: '', loading: true })
    try {
      const base = (meta?.parents.length ?? 1) > 0 ? `${full}~1` : EMPTY_TREE_REF
      const diff = await svc.createPatch(repoPath, base, full)
      const text = await runAiCommitAnalysis(action, {
        subject: commit.message, body: meta?.body ?? '', author: commit.author, hash: commit.hash, diff,
      })
      setDialog({ kind: 'text', title: aiActionTitle(action), text, loading: false })
    } catch (e) {
      setDialog({ kind: 'text', title: aiActionTitle(action), text: `Error: ${String(e)}`, loading: false })
    }
  }

  const downloadPatch = async (refA: string, refB: string, name: string) => {
    try {
      const patch = await svc.createPatch(repoPath, refA, refB)
      const blob = new Blob([patch], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(String(e)) }
  }

  // ── Commit menu dispatch ───────────────────────────────────────────────────
  const handleCommitAction = async (id: string) => {
    const commit = commitMenu?.commit
    if (!commit) return
    const full = commit.fullHash || commit.hash
    const base = (meta?.parents.length ?? 0) > 0 ? `${full}~1` : EMPTY_TREE_REF
    onCloseMenus()

    // Multi-selection actions.
    if (id.startsWith('multi.')) {
      const sel = orderedSelection()
      switch (id) {
        case 'multi.compareFirstLast': setCompare({ refA: sel[0], refB: sel[sel.length - 1], title: 'Compare first ↔ last' }); break
        case 'multi.cherryPick': setDialog({ kind: 'cherryPick', shas: sel }); break
        case 'multi.revert': await runOp(svc.revertCommit(repoPath, sel.join(' '), '', 0), 'Reverted selected commits.'); break
        case 'multi.squash': {
          const oldest = sel[0]
          setRebasePlan(await svc.getRebaseTodo(repoPath, `${oldest}~1`).catch(() => null) as RebasePlan)
          break
        }
        case 'multi.patch': await downloadPatch(`${sel[0]}~1`, sel[sel.length - 1], 'selection.patch'); break
        case 'multi.copyShas': await copy(sel.join('\n'), 'SHAs'); break
        case 'multi.branchFromLatest': setDialog({ kind: 'branch', ref: sel[sel.length - 1], suggested: '' }); break
      }
      return
    }

    switch (id) {
      // Checkout / branch / tag
      case 'checkout': case 'checkout.detached': case 'checkout.branch': setDialog({ kind: 'checkout', ref: full }); break
      case 'branch.create': setDialog({ kind: 'branch', ref: full, suggested: slug(commit.message) }); break
      case 'tag.create': setDialog({ kind: 'tag', ref: full }); break

      // Compare
      case 'compare.head': setCompare({ refA: full, refB: 'HEAD', title: 'Compare with HEAD' }); break
      case 'compare.working': setCompare({ refA: full, refB: '', title: 'Compare with working tree' }); break
      case 'compare.previous': setCompare({ refA: base, refB: full, title: 'Compare with previous commit' }); break
      case 'compare.another': setDialog({ kind: 'prompt', title: 'Compare with another commit', label: 'Commit-ish (or range A..B)', placeholder: '84f63e3..HEAD', onValue: (v) => { setDialog(null); setCompare({ refA: full, refB: v, title: `Compare with ${v}` }) } }); break
      case 'compare.branch': setDialog({ kind: 'prompt', title: 'Compare with branch', label: 'Branch name', placeholder: 'main', onValue: (v) => { setDialog(null); setCompare({ refA: full, refB: v, title: `Compare with ${v}` }) } }); break
      case 'compare.tag': setDialog({ kind: 'prompt', title: 'Compare with tag', label: 'Tag name', placeholder: 'v1.0.0', onValue: (v) => { setDialog(null); setCompare({ refA: full, refB: v, title: `Compare with ${v}` }) } }); break

      // Copy
      case 'copy.fullSha': await copy(full, 'Full SHA'); break
      case 'copy.shortSha': await copy(commit.hash, 'Short SHA'); break
      case 'copy.message': await copy(commit.message, 'Message'); break
      case 'copy.author': await copy(commit.author, 'Author'); break
      case 'copy.remoteUrl': await copy(meta?.remoteURL ?? '', 'Remote URL'); break

      // Cherry-pick / revert
      case 'cherryPick': setDialog({ kind: 'cherryPick', shas: [full] }); break
      case 'revert': {
        const message = await svc.generateRevertMessage(repoPath, full).catch(() => '')
        setDialog({ kind: 'revert', sha: full, isMerge: meta?.isMerge ?? false, parents: meta?.parents ?? [], message })
        break
      }

      // Rebase
      case 'rebase.onto': await runOp(svc.rebaseOnto(repoPath, full), 'Rebased onto commit.'); break
      case 'rebase.interactive': {
        const plan = await svc.getRebaseTodo(repoPath, full).catch((e) => { setError(String(e)); return null })
        if (plan) setRebasePlan(plan)
        break
      }

      // Reset
      case 'reset.soft': setDialog({ kind: 'reset', ref: full, mode: 'soft' }); break
      case 'reset.mixed': setDialog({ kind: 'reset', ref: full, mode: 'mixed' }); break
      case 'reset.hard': setDialog({ kind: 'reset', ref: full, mode: 'hard' }); break

      // More actions
      case 'more.patch.create': await downloadPatch(base, full, `${commit.hash}.patch`); break
      case 'more.patch.copy': try { await navigator.clipboard.writeText(await svc.createPatch(repoPath, base, full)); setInfo('Patch copied.') } catch (e) { setError(String(e)) } break
      case 'more.bisect': setBisect({ bad: full }); break
      case 'more.openRemote': openExternal(meta?.remoteURL ?? ''); break
      case 'more.findRelated': {
        setDialog({ kind: 'text', title: 'Related commits', text: '', loading: true })
        const list = await svc.searchHistory(repoPath, { author: commit.author, limit: 40 }).catch(() => [])
        setDialog({ kind: 'text', title: `Commits by ${commit.author}`, text: list.map((c) => `${c.hash}  ${c.date}  ${c.message}`).join('\n') || 'None found.', loading: false })
        break
      }
      case 'more.fileHistory': setDialog({ kind: 'prompt', title: 'View file history', label: 'File path (relative to repo)', placeholder: 'path/to/file', onValue: async (v) => {
        setDialog({ kind: 'text', title: `History — ${v}`, text: '', loading: true })
        const list = await svc.fileHistory(repoPath, v, 100).catch(() => [])
        setDialog({ kind: 'text', title: `History — ${v}`, text: list.map((c) => `${c.hash}  ${c.date}  ${c.message}`).join('\n') || 'No history.', loading: false })
      } }); break

      // Context-aware HEAD
      case 'head.amend': setDialog({ kind: 'prompt', title: 'Amend commit', label: 'New message (stages working changes)', initial: commit.message, onValue: (v) => void runOp(svc.amendCommit(repoPath, v, true), 'Commit amended.') }); break
      case 'head.editMessage': setDialog({ kind: 'prompt', title: 'Edit commit message', label: 'New message', initial: commit.message, onValue: (v) => void runOp(svc.amendCommit(repoPath, v, false), 'Message updated.') }); break
      case 'head.undo': await runOp(svc.undoLastCommit(repoPath, true), 'Last commit undone (changes kept staged).'); break
      case 'head.squashPrev': await runOp(svc.squashHeadIntoPrevious(repoPath), 'Squashed into previous commit.'); break
      case 'head.extractBranch': setDialog({ kind: 'prompt', title: 'Extract commit into a new branch', label: 'New branch name', placeholder: 'feature/extracted', onValue: (v) => void runOp(svc.extractHeadToNewBranch(repoPath, v), 'Commit extracted to new branch.') }); break

      // Merge-specific
      case 'merge.viewParents': setDialog({ kind: 'text', title: 'Merge parents', text: (meta?.parents ?? []).map((p, i) => `parent ${i + 1}: ${p}`).join('\n'), loading: false }); break
      case 'merge.compareP1': setCompare({ refA: meta?.parents[0] ?? base, refB: full, title: 'Compare with first parent' }); break
      case 'merge.compareP2': setCompare({ refA: meta?.parents[1] ?? base, refB: full, title: 'Compare with second parent' }); break
      case 'merge.firstParent': setCompare({ refA: meta?.parents[0] ?? base, refB: full, title: 'First-parent diff' }); break

      // AI
      case 'ai.explain': case 'ai.summarize': case 'ai.risky': case 'ai.changelog': case 'ai.releaseNotes':
      case 'ai.betterMessage': case 'ai.split': case 'ai.missingTests': case 'ai.genTests':
        await openAi(id as AiActionId, commit); break

      // Danger zone
      case 'danger.forceReset': setDialog({ kind: 'reset', ref: full, mode: 'hard', force: true }); break
      case 'danger.forcePush': await runOp(svc.forcePush(repoPath, currentBranch), 'Force pushed (with lease).'); break
      case 'danger.deleteTag': {
        const tags = meta?.tags ?? []
        if (tags.length === 1) await runOp(GitSync.DeleteTag(repoPath, tags[0]).then(() => ({ success: true } as OpResult)), `Deleted tag ${tags[0]}.`)
        else if (tags.length > 1) setDialog({ kind: 'prompt', title: 'Delete tag', label: `Tag name (${tags.join(', ')})`, onValue: (v) => void runOp(GitSync.DeleteTag(repoPath, v).then(() => ({ success: true } as OpResult)), `Deleted tag ${v}.`) })
        break
      }
    }
  }

  // ── File menu dispatch ─────────────────────────────────────────────────────
  const fileMenuItems = (): ContextMenuItem[] => [
    { id: 'file.open', label: 'Open file at this commit' },
    { id: 'file.compareCurrent', label: 'Compare with current version' },
    { id: 'file.comparePrevious', label: 'Compare with previous version' },
    { id: 'file.restore', label: 'Restore this version', separatorBefore: true },
    { id: 'file.restoreStage', label: 'Restore and stage' },
    { id: 'file.copyPath', label: 'Copy file path', separatorBefore: true },
    { id: 'file.copyRelPath', label: 'Copy relative path' },
    { id: 'file.history', label: 'View file history', separatorBefore: true },
    { id: 'file.blame', label: 'Blame file' },
  ]

  const handleFileAction = async (id: string) => {
    const req = fileMenu
    if (!req) return
    const full = req.commit.fullHash || req.commit.hash
    const path = req.file.path
    onCloseMenus()
    switch (id) {
      case 'file.open': {
        setDialog({ kind: 'text', title: `${path} @ ${req.commit.hash}`, text: '', loading: true })
        const content = await svc.fileAtCommit(repoPath, full, path).catch((e) => `Error: ${e}`)
        setDialog({ kind: 'text', title: `${path} @ ${req.commit.hash}`, text: content, loading: false })
        break
      }
      case 'file.compareCurrent': {
        const [left, right] = await Promise.all([
          svc.fileAtCommit(repoPath, full, path).catch(() => ''),
          GitSync.GetWorkingTreeFileSnapshot(repoPath, path, '').then((r) => (JSON.parse(r) as { newContent: string }).newContent).catch(() => ''),
        ])
        setFileDiff({ title: `Diff — ${path}`, left, right, leftLabel: `${req.commit.hash}`, rightLabel: 'Working tree' })
        break
      }
      case 'file.comparePrevious': {
        const [left, right] = await Promise.all([
          svc.fileAtCommit(repoPath, `${full}~1`, req.file.oldPath || path).catch(() => ''),
          svc.fileAtCommit(repoPath, full, path).catch(() => ''),
        ])
        setFileDiff({ title: `Diff — ${path}`, left, right, leftLabel: 'previous', rightLabel: req.commit.hash })
        break
      }
      case 'file.restore': case 'file.restoreStage': {
        const content = await svc.fileAtCommit(repoPath, full, path).catch(() => '')
        setDialog({ kind: 'restore', ref: full, path, content, refLabel: req.commit.hash, stage: id === 'file.restoreStage' })
        break
      }
      case 'file.copyPath': await copy(path, 'Path'); break
      case 'file.copyRelPath': await copy(path, 'Relative path'); break
      case 'file.history': {
        setDialog({ kind: 'text', title: `History — ${path}`, text: '', loading: true })
        const list = await svc.fileHistory(repoPath, path, 100).catch(() => [])
        setDialog({ kind: 'text', title: `History — ${path}`, text: list.map((c) => `${c.hash}  ${c.date}  ${c.message}`).join('\n') || 'No history.', loading: false })
        break
      }
      case 'file.blame': {
        setDialog({ kind: 'text', title: `Blame — ${path}`, text: '', loading: true })
        const blame = await svc.blameFile(repoPath, path).catch((e) => `Error: ${e}`)
        setDialog({ kind: 'text', title: `Blame — ${path}`, text: blame, loading: false })
        break
      }
    }
  }

  const menuItems: ContextMenuItem[] = commitMenu
    ? (buildCommitMenu({ meta, state: repoState, selectedCount: selectedHashes.length, hasRemote }) as ContextMenuItem[])
    : []

  return (
    <>
      {commitMenu && (selectedHashes.length > 1 || meta) && menuItems.length > 0 && (
        <ContextMenu x={commitMenu.x} y={commitMenu.y} items={menuItems} onSelect={(id) => void handleCommitAction(id)} onClose={onCloseMenus} />
      )}
      {fileMenu && (
        <ContextMenu x={fileMenu.x} y={fileMenu.y} items={fileMenuItems()} onSelect={(id) => void handleFileAction(id)} onClose={onCloseMenus} />
      )}

      {dialog?.kind === 'branch' && (
        <CreateBranchDialog sourceLabel={dialog.ref} suggested={dialog.suggested} busy={busy} onClose={closeDialog}
          onSubmit={(v) => void runOp(svc.createBranchFromCommit(repoPath, v.name, dialog.ref, v.checkout, v.push), `Branch ${v.name} created.`)} />
      )}
      {dialog?.kind === 'tag' && (
        <CreateTagDialog sourceLabel={dialog.ref} busy={busy} onClose={closeDialog}
          onSubmit={(v) => void runOp(svc.createTagFromCommit(repoPath, v.name, dialog.ref, v.message, v.annotated, v.push), `Tag ${v.name} created.`)} />
      )}
      {dialog?.kind === 'checkout' && (
        <CheckoutCommitDialog sourceLabel={dialog.ref} busy={busy} onClose={closeDialog}
          onSubmit={(v) => void runOp(svc.checkoutCommit(repoPath, dialog.ref, v.branch), v.branch ? `Checked out new branch ${v.branch}.` : 'Checked out commit (detached HEAD).')} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetDialog commitLabel={dialog.ref} published={repoState?.published ?? false} protectedBranch={repoState?.protected ?? false} initialMode={dialog.mode} busy={busy} onClose={closeDialog}
          onConfirm={(mode) => void runOp(svc.resetBranchToCommit(repoPath, dialog.ref, mode), `Branch reset (${mode}).`)} />
      )}
      {dialog?.kind === 'cherryPick' && (
        <CherryPickDialog commits={dialog.shas} targetBranch={currentBranch} busy={busy} onClose={closeDialog}
          onSubmit={(v) => void runOp(svc.cherryPickCommits(repoPath, dialog.shas, v.noCommit, v.newBranch, v.recordOrigin), 'Cherry-pick complete.')} />
      )}
      {dialog?.kind === 'revert' && (
        <RevertDialog commitLabel={dialog.sha} isMerge={dialog.isMerge} parents={dialog.parents} initialMessage={dialog.message} busy={busy} onClose={closeDialog}
          onSubmit={(v) => void runOp(svc.revertCommit(repoPath, dialog.sha, v.message, v.mainline), 'Revert commit created.')} />
      )}
      {dialog?.kind === 'restore' && (
        <RestoreFilePreviewDialog path={dialog.path} refLabel={dialog.refLabel} content={dialog.content} busy={busy} onClose={closeDialog}
          onConfirm={() => void runOp(
            dialog.stage
              ? svc.restoreFileFromCommit(repoPath, dialog.ref, dialog.path).then(async (r) => { if (r.success) await GitSync.StageFile(repoPath, dialog.path); return r })
              : svc.restoreFileFromCommit(repoPath, dialog.ref, dialog.path),
            `Restored ${dialog.path}.`,
          )} />
      )}
      {dialog?.kind === 'prompt' && (
        <PromptDialog title={dialog.title} label={dialog.label} placeholder={dialog.placeholder} initial={dialog.initial} busy={busy} onClose={closeDialog} onSubmit={(v) => dialog.onValue(v)} />
      )}
      {dialog?.kind === 'text' && (
        <TextResultDialog title={dialog.title} text={dialog.text} loading={dialog.loading} onClose={closeDialog} />
      )}

      {compare && (
        <CompareView repoPath={repoPath} refA={compare.refA} refB={compare.refB} title={compare.title} onClose={() => setCompare(null)} />
      )}
      {conflict && (
        <ConflictResolverDialog repoPath={repoPath} operation={conflict.operation} initialConflicts={conflict.conflicts}
          onResolved={() => { setConflict(null); setInfo('Operation completed.'); onRefresh() }} onClose={() => setConflict(null)} />
      )}
      {rebasePlan && (
        <InteractiveRebaseDialog repoPath={repoPath} plan={rebasePlan}
          onStarted={(res) => { setRebasePlan(null); if (res.code === 'conflict') setConflict({ operation: 'rebase', conflicts: res.conflicts.map((c) => c.path) }); else { setInfo('Rebase complete.'); onRefresh() } }}
          onClose={() => setRebasePlan(null)} />
      )}
      {bisect && (
        <BisectPanel repoPath={repoPath} initialBad={bisect.bad} onRefresh={onRefresh} onClose={() => { setBisect(null); onRefresh() }} />
      )}
      {fileDiff && (
        <DiffModal title={fileDiff.title} leftLabel={fileDiff.leftLabel} rightLabel={fileDiff.rightLabel} leftBody={fileDiff.left} rightBody={fileDiff.right} onClose={() => setFileDiff(null)} />
      )}
    </>
  )
}
