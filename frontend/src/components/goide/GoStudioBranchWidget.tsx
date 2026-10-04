import { useEffect, useState } from 'react'
import { showModule } from '@/lib/moduleRouting'
import { ChevronDown, GitBranch, GitCommitHorizontal, GitPullRequestArrow } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import { confirm } from '@/lib/confirmDialog'
import { dirtyGoIDEDocuments, useGoIDEStore } from '@/stores/goide'
import { syncGitStudioToSession, useGoIDEVCSStore } from '@/stores/goideVcs'

const GIT_STUDIO_ITEM = 'open-git-studio'
const COMMIT_ITEM = 'commit'

interface GoStudioBranchWidgetProps {
  sessionId: string
  onCommit: () => void
}

/**
 * Branch corrente nella toolbar, come nel mock: cambio branch confermato, Commit e rimando a Git Studio
 * per ciò che Go Studio non gestisce (push/pull, conflitti, rebase, stash). Nessuna operazione di rete.
 */
export function GoStudioBranchWidget({ sessionId, onCommit }: GoStudioBranchWidgetProps) {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    void useGoIDEVCSStore.getState().refreshStatus(sessionId).then(() => syncGitStudioToSession(sessionId))
  }, [sessionId])
  if (!status?.available) return null

  const changes = status.changes.length
  const items: ContextMenuItem[] = [
    { id: COMMIT_ITEM, label: changes ? `Commit… (${changes} changed)` : 'Commit…', shortcut: 'Ctrl+K', disabled: changes === 0, disabledReason: 'No local changes', icon: GitCommitHorizontal },
    ...status.branches.map((branch, index) => ({ id: `branch:${branch}`, label: branch, icon: GitBranch, checked: branch === status.branch || undefined, disabled: branch === status.branch, separatorBefore: index === 0 })),
    { id: GIT_STUDIO_ITEM, label: 'Push, pull, conflicts, rebase, stash → Git Studio', icon: GitPullRequestArrow, separatorBefore: true },
  ]

  const checkout = async (branch: string) => {
    const dirty = dirtyGoIDEDocuments(useGoIDEStore.getState(), sessionId).length
    const approved = await confirm({
      title: `Switch to ${branch}?`,
      message: `Command: git checkout ${branch}\n\n${dirty ? `${dirty} unsaved editor(s) keep their text; files that change on disk will ask to reload or compare.\n` : ''}Git refuses the switch if uncommitted changes would be overwritten.`,
      confirmLabel: 'Switch branch',
    })
    if (!approved) return
    if (await useGoIDEVCSStore.getState().checkout(sessionId, branch)) await useGoIDEStore.getState().checkActiveDocument()
    else useGoIDEStore.setState({ error: useGoIDEVCSStore.getState().error ?? `Could not switch to ${branch}` })
  }

  const select = (id: string) => {
    setMenu(null)
    if (id === COMMIT_ITEM) return onCommit()
    if (id === GIT_STUDIO_ITEM) return showModule('gitsync')
    if (id.startsWith('branch:')) void checkout(id.slice('branch:'.length))
  }

  return (
    <>
      <button type="button" aria-haspopup="menu" aria-expanded={!!menu} title={`Branch ${status.branch}${status.ahead || status.behind ? ` · ↑${status.ahead} ↓${status.behind}` : ''} · ${changes} local change(s)`}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom + 4 }) }}
        className={`go-studio-widget max-w-52 ${menu ? 'is-active' : ''}`}>
        <GitBranch size={14} strokeWidth={1.9} className="shrink-0 text-text-3" />
        <span className="truncate text-[13px] font-medium">{status.branch || 'detached'}</span>
        {status.behind > 0 && <span className="shrink-0 rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">↓{status.behind}</span>}
        {status.ahead > 0 && <span className="shrink-0 rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">↑{status.ahead}</span>}
        {changes > 0 && <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-px text-[10.5px] font-medium tabular-nums text-text-2" title={`${changes} local change(s)`}>{changes}</span>}
        <ChevronDown size={12} className="shrink-0 text-text-4" />
      </button>
      {menu && <ContextMenu appearance="studio" x={menu.x} y={menu.y} items={items} onSelect={select} onClose={() => setMenu(null)} />}
    </>
  )
}
