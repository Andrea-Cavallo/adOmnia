import { useEffect, useState } from 'react'
import { getProjectPermissionRules, saveProjectPermissionRules } from '@/lib/milk-api'

const CATEGORIES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'read', label: 'Read', hint: 'read and search files' },
  { id: 'write', label: 'Write', hint: 'edit, delete or move files' },
  { id: 'shell', label: 'Shell', hint: 'run commands' },
  { id: 'network', label: 'Network', hint: 'fetch URLs' },
  { id: 'other', label: 'Other', hint: 'any other tool' },
]

/** Human label of a permission category reported with a permission request. */
export const permissionCategoryLabel = (category?: string) => CATEGORIES.find((item) => item.id === category)?.label

/**
 * Per-category tool permission rules of an ACP agent: ask (default), allow or deny without asking.
 * Deny wins even when every tool call is approved automatically.
 */
export function AgentPermissionRules({ rules, onChange }: { rules: Record<string, string | undefined> | undefined; onChange: (rules: Record<string, string>) => void }) {
  const current = rules ?? {}
  const set = (category: string, rule: string) => {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(current)) if (value && key !== category) next[key] = value
    if (rule !== 'ask') next[category] = rule
    onChange(next)
  }
  return <div className="flex flex-col gap-1">
    <p className="text-[11px] text-text-3">Per category: ask every time, allow without asking, or deny. Decisions taken by a rule appear in the agent timeline.</p>
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      {CATEGORIES.map((category) => <div key={category.id} className="contents">
        <span className="text-[12px] text-text-1">{category.label}</span>
        <span className="text-[11px] text-text-4">{category.hint}</span>
        <select className="gs-input h-7 text-[11px]" aria-label={`${category.label} permission`} value={current[category.id] ?? 'ask'} onChange={(event) => set(category.id, event.target.value)}>
          <option value="ask">Ask</option>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </div>)}
    </div>
  </div>
}

/**
 * Rules of one project, shared by every agent: a Deny at either level wins, then an Allow.
 * Stored in the adOmnia data folder, not in the repository; revoking the project's trust clears them.
 */
export function ProjectAgentPermissionRules({ root }: { root: string }) {
  const [rules, setRules] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!root) return
    let live = true
    void getProjectPermissionRules(root)
      .then((loaded) => { if (live) { setRules(loaded); setError('') } })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { live = false }
  }, [root])
  if (!root) return <p className="gs-list-empty">Open a project to set its agent permissions.</p>
  const change = (next: Record<string, string>) => {
    const previous = rules
    setRules(next)
    void saveProjectPermissionRules(root, next)
      .then((saved) => { setRules(saved); setError('') })
      .catch((cause: unknown) => { setRules(previous); setError(cause instanceof Error ? cause.message : String(cause)) })
  }
  return <div className="flex flex-col gap-2">
    <p className="text-[12px] text-text-3">Apply to every agent (milk, Claude Code, Pi) working in this project or in one of its task worktrees, on top of each agent's own rules: a Deny at either level wins, then an Allow. Kept on this machine, not in the repository; revoking the project's trust clears them.</p>
    {rules ? <AgentPermissionRules rules={rules} onChange={change} /> : !error && <p className="text-[11px] text-text-4">Loading…</p>}
    {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
  </div>
}
