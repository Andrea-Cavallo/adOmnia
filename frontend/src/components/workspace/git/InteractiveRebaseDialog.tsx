import { useState } from 'react'
import { AlertTriangle, GripVertical, Loader2 } from 'lucide-react'
import { startInteractiveRebase } from '@/lib/git/gitService'
import type { OpResult, RebaseAction, RebasePlan, RebaseTodoItem } from '@/lib/git/types'
import { cn } from '@/lib/utils'

interface InteractiveRebaseDialogProps {
  repoPath: string
  plan: RebasePlan
  onStarted: (res: OpResult) => void
  onClose: () => void
}

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

const ACTION_COLOR: Record<RebaseAction, string> = {
  pick: 'text-text-2',
  reword: 'text-accent',
  edit: 'text-warning',
  squash: 'text-info',
  fixup: 'text-info',
  drop: 'text-error',
}

/**
 * Visual interactive-rebase planner. Commits (oldest first) are reorderable by
 * drag-and-drop; each can be pick/reword/edit/squash/fixup/drop. Reword exposes
 * an inline message field. The plan summary warns when the branch is published
 * (a force-push will be required).
 */
export function InteractiveRebaseDialog({ repoPath, plan, onStarted, onClose }: InteractiveRebaseDialogProps) {
  const [items, setItems] = useState<RebaseTodoItem[]>(plan.items.map((i) => ({ ...i })))
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const setAction = (index: number, action: RebaseAction) =>
    setItems((cur) => cur.map((it, i) => (i === index ? { ...it, action } : it)))
  const setNewMessage = (index: number, newMessage: string) =>
    setItems((cur) => cur.map((it, i) => (i === index ? { ...it, newMessage } : it)))

  const onDrop = (target: number) => {
    if (dragIndex === null || dragIndex === target) return
    setItems((cur) => {
      const next = [...cur]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(target, 0, moved)
      return next
    })
    setDragIndex(null)
  }

  const rewritten = items.filter((i) => i.action !== 'pick').length
  const willForcePush = plan.published

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await startInteractiveRebase(repoPath, plan.baseRef, items)
      if (res.success || res.code === 'conflict') onStarted(res)
      else setError(res.error || 'Rebase failed.')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className="flex max-h-[82vh] w-[620px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border-1 px-4 py-3">
          <div className="text-sm font-semibold text-text-1">Interactive rebase</div>
          <div className="mt-0.5 font-mono text-[10px] text-text-4">{plan.branch} · base {plan.baseRef.slice(0, 9)} · {items.length} commits</div>
        </div>

        {error && <div className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {items.map((it, index) => (
              <div
                key={it.hash}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
                className={cn(
                  'flex items-center gap-2 rounded border border-border-1 bg-surface-0 px-2 py-1.5',
                  dragIndex === index && 'opacity-50',
                  it.action === 'drop' && 'opacity-60',
                )}
              >
                <GripVertical size={13} className="shrink-0 cursor-grab text-text-4" />
                <select
                  value={it.action}
                  onChange={(e) => setAction(index, e.target.value as RebaseAction)}
                  className={cn('h-6 w-[78px] shrink-0 rounded border border-border-2 bg-surface-2 px-1 text-[10px] font-semibold outline-none focus:border-accent', ACTION_COLOR[it.action])}
                >
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <code className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[10px] text-accent">{it.hash.slice(0, 7)}</code>
                {it.action === 'reword' ? (
                  <input
                    value={it.newMessage ?? it.message}
                    onChange={(e) => setNewMessage(index, e.target.value)}
                    className="h-6 min-w-0 flex-1 rounded border border-accent/40 bg-surface-2 px-1.5 text-[11px] text-text-1 outline-none focus:border-accent"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text-2" title={it.message}>{it.message}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Plan summary */}
        <div className="border-t border-border-1 bg-surface-0 px-4 py-2 text-[11px] text-text-3">
          <div>{rewritten} of {items.length} commits will be rewritten on <span className="font-mono text-text-2">{plan.branch}</span>.</div>
          {willForcePush && (
            <div className="mt-1 flex items-center gap-1.5 text-warning"><AlertTriangle size={12} /> This branch is published — a force push will be required afterward.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">
          <button onClick={onClose} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1">Cancel</button>
          <button disabled={busy || items.every((i) => i.action === 'drop')} onClick={() => void start()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-medium text-white hover:bg-accent-light disabled:opacity-40">
            {busy && <Loader2 size={12} className="animate-spin" />} Start rebase
          </button>
        </div>
      </div>
    </div>
  )
}
