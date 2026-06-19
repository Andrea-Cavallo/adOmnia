// Pure, unit-tested model that decides WHICH commit context-menu actions exist
// and whether each is enabled, from commit + repository + selection state. The
// UI component only maps action ids to handlers and renders this tree — keeping
// all the "is this action valid right now?" logic in one testable place.

import type { CommitMeta, RepoState } from './types'

export interface MenuActionNode {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  disabledReason?: string
  submenu?: MenuActionNode[]
  /** Render a separator above this item (groups the menu). */
  separatorBefore?: boolean
}

export interface CommitMenuContext {
  meta: CommitMeta | null
  state: RepoState | null
  /** Number of commits currently selected in the graph (>=1). */
  selectedCount: number
  hasRemote: boolean
}

const ENABLED = { disabled: false }

function item(id: string, label: string, extra?: Partial<MenuActionNode>): MenuActionNode {
  return { id, label, ...ENABLED, ...extra }
}

function disabledIf(cond: boolean, reason: string): Partial<MenuActionNode> {
  return cond ? { disabled: true, disabledReason: reason } : {}
}

/** AI analysis actions — never mutate the repo, only analyze the diff. */
const AI_ACTIONS: MenuActionNode[] = [
  item('ai.explain', 'Explain this commit'),
  item('ai.summarize', 'Summarize changes'),
  item('ai.risky', 'Detect risky changes'),
  item('ai.changelog', 'Generate changelog entry'),
  item('ai.releaseNotes', 'Generate release notes'),
  item('ai.betterMessage', 'Suggest a better commit message'),
  item('ai.split', 'Suggest how to split the commit'),
  item('ai.missingTests', 'Identify missing tests'),
  item('ai.genTests', 'Generate tests for changed code'),
]

function multiSelectMenu(count: number): MenuActionNode[] {
  return [
    item('multi.compareFirstLast', `Compare first with last (${count} commits)`),
    item('multi.cherryPick', 'Cherry-pick selected commits', { separatorBefore: true }),
    item('multi.revert', 'Revert selected commits'),
    item('multi.squash', 'Squash selected commits'),
    item('multi.patch', 'Create patch from selection', { separatorBefore: true }),
    item('multi.copyShas', 'Copy selected SHAs'),
    item('multi.branchFromLatest', 'Create branch from latest selected'),
  ]
}

/**
 * buildCommitMenu returns the ordered top-level nodes for the commit context
 * menu. Submenus hold secondary operations so the primary list stays compact.
 */
export function buildCommitMenu(ctx: CommitMenuContext): MenuActionNode[] {
  if (ctx.selectedCount > 1) return multiSelectMenu(ctx.selectedCount)

  const meta = ctx.meta
  if (!meta) return []
  const state = ctx.state
  const isHead = meta.isHead
  const hasParent = meta.parents.length > 0
  const onBranch = meta.onCurrentBranch
  const published = meta.published
  const hasRemote = ctx.hasRemote
  const isMerge = meta.isMerge
  const localHead = isHead && !published // local, unpushed HEAD

  // ── Checkout ────────────────────────────────────────────────────────────────
  const checkout = item('checkout', 'Checkout commit', {
    ...disabledIf(isHead, 'This commit is already checked out'),
    submenu: [
      item('checkout.detached', 'Checkout (detached HEAD)'),
      item('checkout.branch', 'Checkout and create branch…'),
    ],
  })

  // ── Compare ─────────────────────────────────────────────────────────────────
  const compare = item('compare', 'Compare with', {
    separatorBefore: true,
    submenu: [
      item('compare.head', 'Current HEAD', disabledIf(isHead, 'This commit is HEAD')),
      item('compare.working', 'Working tree'),
      item('compare.previous', 'Previous commit', disabledIf(!hasParent, 'This commit has no parent')),
      item('compare.another', 'Another commit…'),
      item('compare.branch', 'Branch…'),
      item('compare.tag', 'Tag…'),
    ],
  })

  // ── Copy ────────────────────────────────────────────────────────────────────
  const copy = item('copy', 'Copy', {
    submenu: [
      item('copy.fullSha', 'Full commit SHA'),
      item('copy.shortSha', 'Short commit SHA'),
      item('copy.message', 'Commit message'),
      item('copy.author', 'Author'),
      item('copy.remoteUrl', 'Remote URL', disabledIf(!hasRemote, 'No compatible remote configured')),
    ],
  })

  // ── Rebase ──────────────────────────────────────────────────────────────────
  const rebase = item('rebase', 'Rebase', {
    submenu: [
      item('rebase.onto', 'Rebase current branch onto this commit', disabledIf(onBranch, 'This commit is already in the current branch')),
      item('rebase.interactive', 'Start interactive rebase from here…', disabledIf(!onBranch || isHead, !onBranch ? 'Not on the current branch' : 'No commits after HEAD to rebase')),
    ],
  })

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = item('reset', 'Reset current branch to this commit', {
    ...disabledIf(isHead, 'The branch is already at this commit'),
    submenu: [
      item('reset.soft', 'Soft — keep changes staged'),
      item('reset.mixed', 'Mixed — keep changes unstaged'),
      item('reset.hard', 'Hard — discard local changes', { danger: true }),
    ],
  })

  // ── More actions (secondary + context-aware) ────────────────────────────────
  const more: MenuActionNode[] = [
    item('more.patch.create', 'Create patch…'),
    item('more.patch.copy', 'Copy patch to clipboard'),
    item('more.bisect', 'Start bisect from here…', { separatorBefore: true }),
    item('more.openRemote', 'Open commit in remote', disabledIf(!hasRemote, 'No compatible remote configured')),
    item('more.fileHistory', 'View file history…'),
    item('more.findRelated', 'Find related commits'),
  ]
  if (localHead) {
    more.push(
      item('head.amend', 'Amend commit…', { separatorBefore: true }),
      item('head.editMessage', 'Edit commit message…'),
      item('head.undo', 'Undo last commit'),
      item('head.squashPrev', 'Squash into previous commit', disabledIf(!hasParent, 'No previous commit')),
      item('head.extractBranch', 'Extract commit into a new branch…', disabledIf(!hasParent, 'Cannot rewind the root commit')),
    )
  }
  if (isMerge) {
    more.push(
      item('merge.viewParents', 'View merge parents', { separatorBefore: true }),
      item('merge.compareP1', 'Compare with first parent'),
      item('merge.compareP2', 'Compare with second parent'),
      item('merge.firstParent', 'Show first-parent history'),
    )
  }
  const moreActions = item('more', 'More actions', { separatorBefore: true, submenu: more })

  // ── AI actions ──────────────────────────────────────────────────────────────
  const ai = item('ai', 'AI Actions', { submenu: AI_ACTIONS })

  // ── Danger zone ─────────────────────────────────────────────────────────────
  const danger = item('danger', 'Danger zone', {
    separatorBefore: true,
    danger: true,
    submenu: [
      item('danger.forceReset', 'Force reset…', { danger: true }),
      item('danger.forcePush', 'Force push…', { danger: true, ...disabledIf(!hasRemote, 'No remote to push to') }),
      item('danger.deleteTag', 'Delete tag…', { danger: true, ...disabledIf(meta.tags.length === 0, 'This commit has no tags') }),
    ],
  })

  // Cherry-pick is redundant for commits already on the current branch.
  const cherryPick = item('cherryPick', 'Cherry-pick…', {
    separatorBefore: true,
    ...disabledIf(onBranch, 'This commit is already on the current branch'),
  })
  const revert = isMerge
    ? item('revert', 'Revert merge commit…')
    : item('revert', 'Revert commit…')

  // Surface a published-history warning hint on rewrite-capable groups by
  // leaving the actions enabled (the dialogs confirm) — state carries the flag.
  void state

  return [
    checkout,
    item('branch.create', 'Create branch from here…'),
    item('tag.create', 'Create tag from here…'),
    compare,
    copy,
    cherryPick,
    revert,
    rebase,
    reset,
    moreActions,
    ai,
    danger,
  ]
}
