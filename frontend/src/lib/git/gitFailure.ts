import * as GitSync from '@/wailsjs/go/main/GitSync'
import { confirm, type ConfirmDetail } from '@/lib/confirmDialog'

export type GitRecovery = 'stash-retry' | 'resolve-conflicts' | 'abort'

export interface GitFailureExplanation {
  title: string
  message: string
  details: ConfirmDetail[]
  recovery: GitRecovery | null
}

type Rule = { test: RegExp; title: string; message: string; recovery: GitRecovery | null }

// Ordered: the first match wins, so the specific cases come before the network/auth ones.
const RULES: Rule[] = [
  {
    test: /CONFLICT|could not apply|Resolve all conflicts|fix conflicts|rebase in progress|merge conflict/i,
    title: 'Pull stopped on conflicts',
    message: 'Your changes and the remote ones touch the same lines. Nothing is lost: resolve the conflicted files to continue, or abort to go back to how things were before the pull.',
    recovery: 'resolve-conflicts',
  },
  {
    test: /would be overwritten|commit your changes or stash|unstaged changes|uncommitted changes|cannot pull with rebase/i,
    title: 'Local changes are in the way',
    message: 'The pull would overwrite files you have modified. adOmnia can stash your changes, pull, and bring them back.',
    recovery: 'stash-retry',
  },
  {
    test: /index\.lock|Unable to create .*\.lock/i,
    title: 'Another Git process is running',
    message: 'Git left a lock file in this repository. Close other Git tools (or wait a moment) and try again. If none is running, the .git/index.lock file is stale and can be deleted.',
    recovery: null,
  },
  {
    test: /Authentication failed|could not read Username|Permission denied|publickey|403|Invalid username or password/i,
    title: 'Git could not sign in to the remote',
    message: 'The remote refused your credentials. Check the token or SSH key for this remote, then try again.',
    recovery: null,
  },
  {
    test: /Could not resolve host|unable to access|Connection (timed out|refused|reset)|Network is unreachable|timed out/i,
    title: 'Cannot reach the remote',
    message: 'Git could not connect to the remote server. Check your network or VPN and try again.',
    recovery: null,
  },
  {
    test: /no tracking information|couldn't find remote ref|no upstream|does not appear to be a git repository/i,
    title: 'This branch has no remote counterpart',
    message: 'The current branch is not linked to a branch on the remote. Push it first (or set its upstream) and then pull.',
    recovery: null,
  },
  {
    test: /non-fast-forward|rejected|fetch first|failed to push/i,
    title: 'The remote has newer commits',
    message: 'Someone pushed to this branch since your last pull. Pull first, then push again.',
    recovery: null,
  },
]

/** `git <args>: exit status 1\n<stderr>` → the command and the readable git output, separately. */
function splitRaw(raw: string): { command: string; output: string } {
  const [first = '', ...rest] = raw.trim().split('\n')
  const match = /^(git [^:]+?): (?:exit status \d+|.*)$/.exec(first)
  if (!match) return { command: '', output: raw.trim() }
  return { command: match[1], output: rest.join('\n').trim() }
}

export function explainGitFailure(raw: string, operation: string): GitFailureExplanation {
  const { command, output } = splitRaw(raw)
  const rule = RULES.find((item) => item.test.test(raw))
  const details: ConfirmDetail[] = []
  if (command) details.push({ label: 'Command', value: command, mono: true })
  if (output) details.push({ label: 'Git said', value: output, mono: true })
  return {
    title: rule?.title ?? `Git could not complete the ${operation}`,
    message: rule?.message ?? 'Git reported an error. The details below are the exact output, ready to copy.',
    details,
    recovery: rule?.recovery ?? null,
  }
}

const ACTION_LABEL: Record<GitRecovery, string> = {
  'stash-retry': 'Stash, pull & restore',
  'resolve-conflicts': 'Resolve conflicts',
  abort: 'Abort pull',
}

export interface GitFailureContext {
  /** Raw error text from the backend. */
  error: unknown
  operation: 'pull' | 'push' | 'git operation'
  repoPath: string
  /** Re-runs the failed operation (used after stashing). */
  retry: () => Promise<void>
  /** Opens the conflict resolver; when missing, conflicts offer "Abort pull" instead. */
  onResolveConflicts?: () => void
  /** Called after any recovery step so the caller can refresh its views. */
  onSettled?: () => void | Promise<void>
}

/** Shows the failure in the app dialog and, when the user accepts, runs the matching recovery. */
export async function presentGitFailure(ctx: GitFailureContext): Promise<void> {
  const raw = ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
  const explained = explainGitFailure(raw, ctx.operation)
  let recovery = explained.recovery
  if (recovery === 'resolve-conflicts' && !ctx.onResolveConflicts) recovery = 'abort'
  const accepted = await confirm({
    title: explained.title,
    message: explained.message,
    details: explained.details,
    confirmLabel: recovery ? ACTION_LABEL[recovery] : 'Close',
    cancelLabel: recovery ? 'Not now' : '',
    variant: 'default',
  })
  if (!accepted || !recovery) return
  try {
    if (recovery === 'resolve-conflicts') ctx.onResolveConflicts?.()
    else if (recovery === 'abort') await GitSync.AbortIntegration(ctx.repoPath)
    else await stashAndRetry(ctx)
  } catch (error) {
    await presentGitFailure({ ...ctx, error })
  } finally {
    await ctx.onSettled?.()
  }
}

async function stashAndRetry(ctx: GitFailureContext): Promise<void> {
  await GitSync.Stash(ctx.repoPath)
  await ctx.retry()
  await GitSync.StashPop(ctx.repoPath)
}
