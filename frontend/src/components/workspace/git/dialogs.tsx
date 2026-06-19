import { useState } from 'react'
import { AlertTriangle, ClipboardCopy, GitBranch, Loader2, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const INPUT = 'h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent placeholder:text-text-4'

// ── Shared compact modal shell ───────────────────────────────────────────────

export function DialogShell({
  title, icon, onClose, children, footer, width = 'w-[420px]', danger = false,
}: {
  title: string
  icon?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
  width?: string
  danger?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-6" onClick={onClose}>
      <div className={cn('flex max-h-[82vh] flex-col overflow-hidden rounded-xl border bg-surface-1 shadow-2xl', danger ? 'border-error/40' : 'border-border-2', width)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border-1 px-4 py-3">
          {icon}
          <div className="text-sm font-semibold text-text-1">{title}</div>
          <button onClick={onClose} className="ml-auto rounded p-1 text-text-3 hover:bg-surface-2 hover:text-text-1"><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3">{footer}</div>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-4">{children}</div>
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      {label}
    </label>
  )
}

function PrimaryBtn({ onClick, disabled, busy, children, danger }: { onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn('flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium text-white disabled:opacity-40', danger ? 'bg-error hover:bg-error/85' : 'bg-accent hover:bg-accent-light')}>
      {busy && <Loader2 size={12} className="animate-spin" />}{children}
    </button>
  )
}

function CancelBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="h-7 rounded px-3 text-xs text-text-2 hover:bg-surface-3 hover:text-text-1">Cancel</button>
}

// ── Create branch ────────────────────────────────────────────────────────────

export function CreateBranchDialog({ sourceLabel, suggested, busy, onClose, onSubmit }: {
  sourceLabel: string
  suggested: string
  busy: boolean
  onClose: () => void
  onSubmit: (v: { name: string; checkout: boolean; push: boolean }) => void
}) {
  const [name, setName] = useState(suggested)
  const [checkout, setCheckout] = useState(true)
  const [push, setPush] = useState(false)
  const valid = /^[^\s~^:?*[\\]+$/.test(name.trim()) && !name.trim().endsWith('/')
  return (
    <DialogShell title="Create branch from commit" icon={<GitBranch size={15} className="text-accent" />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit({ name: name.trim(), checkout, push })} disabled={!valid || busy} busy={busy}>Create</PrimaryBtn></>}>
      <div><FieldLabel>Branch name</FieldLabel><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="feature/my-branch" />
        {!valid && name.trim() !== '' && <div className="mt-1 text-[10px] text-error">Invalid branch name.</div>}</div>
      <div><FieldLabel>Source commit</FieldLabel><div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-3">{sourceLabel}</div></div>
      <div className="space-y-1.5"><Check checked={checkout} onChange={setCheckout} label="Check out after creation" /><Check checked={push} onChange={setPush} label="Push to origin" /></div>
    </DialogShell>
  )
}

// ── Create tag ───────────────────────────────────────────────────────────────

export function CreateTagDialog({ sourceLabel, busy, onClose, onSubmit }: {
  sourceLabel: string
  busy: boolean
  onClose: () => void
  onSubmit: (v: { name: string; annotated: boolean; message: string; push: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [annotated, setAnnotated] = useState(false)
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const valid = /^[^\s~^:?*[\\]+$/.test(name.trim())
  return (
    <DialogShell title="Create tag from commit" icon={<Tag size={15} className="text-accent" />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit({ name: name.trim(), annotated, message, push })} disabled={!valid || busy} busy={busy}>Create</PrimaryBtn></>}>
      <div><FieldLabel>Tag name</FieldLabel><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="v1.2.0" /></div>
      <div className="flex gap-4 text-xs text-text-2">
        <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" checked={!annotated} onChange={() => setAnnotated(false)} className="accent-accent" /> Lightweight</label>
        <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" checked={annotated} onChange={() => setAnnotated(true)} className="accent-accent" /> Annotated</label>
      </div>
      {annotated && <div><FieldLabel>Message</FieldLabel><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} className={cn(INPUT, 'h-auto resize-none py-1.5')} placeholder="Release notes…" /></div>}
      <div><FieldLabel>Source commit</FieldLabel><div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-3">{sourceLabel}</div></div>
      <Check checked={push} onChange={setPush} label="Push tag to origin" />
    </DialogShell>
  )
}

// ── Checkout commit (detached vs new branch, with warning) ───────────────────

export function CheckoutCommitDialog({ sourceLabel, busy, onClose, onSubmit }: {
  sourceLabel: string
  busy: boolean
  onClose: () => void
  onSubmit: (v: { branch: string }) => void
}) {
  const [mode, setMode] = useState<'detached' | 'branch'>('branch')
  const [branch, setBranch] = useState('')
  const valid = mode === 'detached' || /^[^\s~^:?*[\\]+$/.test(branch.trim())
  return (
    <DialogShell title="Checkout commit" icon={<GitBranch size={15} className="text-accent" />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit({ branch: mode === 'branch' ? branch.trim() : '' })} disabled={!valid || busy} busy={busy}>Checkout</PrimaryBtn></>}>
      <div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-3">{sourceLabel}</div>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-text-2"><input type="radio" checked={mode === 'branch'} onChange={() => setMode('branch')} className="mt-0.5 accent-accent" /><span><span className="font-medium text-text-1">Checkout and create branch</span><br /><span className="text-text-4">Safest — your work stays on a named branch.</span></span></label>
      {mode === 'branch' && <input autoFocus value={branch} onChange={(e) => setBranch(e.target.value)} className={INPUT} placeholder="branch name" />}
      <label className="flex cursor-pointer items-start gap-2 text-xs text-text-2"><input type="radio" checked={mode === 'detached'} onChange={() => setMode('detached')} className="mt-0.5 accent-accent" /><span><span className="font-medium text-text-1">Checkout (detached HEAD)</span><br /><span className="text-text-4">Inspect this commit without a branch.</span></span></label>
      {mode === 'detached' && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> In detached HEAD, new commits can become unreachable unless you create a branch.</div>
      )}
    </DialogShell>
  )
}

// ── Reset (soft/mixed/hard) ──────────────────────────────────────────────────

const RESET_DESC: Record<string, string> = {
  soft: 'Move the branch pointer and keep changes staged.',
  mixed: 'Move the branch pointer and keep changes unstaged.',
  hard: 'Move the branch pointer and discard local changes.',
}

export function ResetDialog({ commitLabel, published, protectedBranch, initialMode = 'mixed', busy, onClose, onConfirm }: {
  commitLabel: string
  published: boolean
  protectedBranch: boolean
  initialMode?: 'soft' | 'mixed' | 'hard'
  busy: boolean
  onClose: () => void
  onConfirm: (mode: 'soft' | 'mixed' | 'hard') => void
}) {
  const [mode, setMode] = useState<'soft' | 'mixed' | 'hard'>(initialMode)
  const isHard = mode === 'hard'
  return (
    <DialogShell title="Reset current branch to commit" danger={isHard} icon={<AlertTriangle size={15} className={isHard ? 'text-error' : 'text-warning'} />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn danger={isHard} onClick={() => onConfirm(mode)} disabled={busy} busy={busy}>{isHard ? 'Discard & reset' : 'Reset'}</PrimaryBtn></>}>
      <div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-3">{commitLabel}</div>
      <div className="space-y-1.5">
        {(['soft', 'mixed', 'hard'] as const).map((m) => (
          <label key={m} className={cn('flex cursor-pointer items-start gap-2 rounded border p-2 text-xs', mode === m ? (m === 'hard' ? 'border-error/50 bg-error/5' : 'border-accent/50 bg-accent/5') : 'border-border-1')}>
            <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 accent-accent" />
            <span><span className={cn('font-medium capitalize', m === 'hard' ? 'text-error' : 'text-text-1')}>{m}</span><br /><span className="text-text-4">{RESET_DESC[m]}</span></span>
          </label>
        ))}
      </div>
      {(published || protectedBranch) && (
        <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{protectedBranch ? 'This is a protected branch. ' : ''}{published ? 'This branch is published — rewriting it will require a force push.' : ''}</div>
      )}
    </DialogShell>
  )
}

// ── Cherry-pick ──────────────────────────────────────────────────────────────

export function CherryPickDialog({ commits, targetBranch, busy, onClose, onSubmit }: {
  commits: string[]
  targetBranch: string
  busy: boolean
  onClose: () => void
  onSubmit: (v: { noCommit: boolean; newBranch: string; recordOrigin: boolean }) => void
}) {
  const [noCommit, setNoCommit] = useState(false)
  const [recordOrigin, setRecordOrigin] = useState(false)
  const [useNewBranch, setUseNewBranch] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  return (
    <DialogShell title={`Cherry-pick ${commits.length > 1 ? `${commits.length} commits` : 'commit'}`} icon={<GitBranch size={15} className="text-accent" />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit({ noCommit, newBranch: useNewBranch ? newBranch.trim() : '', recordOrigin })} disabled={busy || (useNewBranch && !newBranch.trim())} busy={busy}>Cherry-pick</PrimaryBtn></>}>
      <div><FieldLabel>Commits (in order)</FieldLabel><div className="space-y-0.5">{commits.map((c) => <code key={c} className="block truncate rounded bg-surface-0 px-2 py-1 font-mono text-[10px] text-accent">{c.slice(0, 9)}</code>)}</div></div>
      <div><FieldLabel>Target branch</FieldLabel><div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-2">{targetBranch}</div></div>
      <div className="space-y-1.5">
        <Check checked={!noCommit} onChange={(v) => setNoCommit(!v)} label="Commit automatically" />
        <Check checked={noCommit} onChange={setNoCommit} label="Keep changes staged (no commit)" />
        <Check checked={recordOrigin} onChange={setRecordOrigin} label="Record origin (-x)" />
        <Check checked={useNewBranch} onChange={setUseNewBranch} label="Create a new branch first" />
        {useNewBranch && <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} className={INPUT} placeholder="new branch name" />}
      </div>
    </DialogShell>
  )
}

// ── Revert ───────────────────────────────────────────────────────────────────

export function RevertDialog({ commitLabel, isMerge, parents, initialMessage, busy, onClose, onSubmit }: {
  commitLabel: string
  isMerge: boolean
  parents: string[]
  initialMessage: string
  busy: boolean
  onClose: () => void
  onSubmit: (v: { message: string; mainline: number }) => void
}) {
  const [message, setMessage] = useState(initialMessage)
  const [mainline, setMainline] = useState(1)
  return (
    <DialogShell title="Revert commit" icon={<AlertTriangle size={15} className="text-warning" />} onClose={onClose} width="w-[460px]"
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit({ message, mainline })} disabled={busy} busy={busy}>Revert</PrimaryBtn></>}>
      <div className="rounded border border-border-1 bg-surface-0 px-2 py-1.5 font-mono text-[11px] text-text-3">{commitLabel}</div>
      {isMerge && (
        <div>
          <FieldLabel>Mainline parent (merge commit)</FieldLabel>
          <div className="flex gap-2">
            {parents.map((p, i) => (
              <label key={p} className={cn('flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px]', mainline === i + 1 ? 'border-accent/50 bg-accent/5 text-text-1' : 'border-border-1 text-text-3')}>
                <input type="radio" checked={mainline === i + 1} onChange={() => setMainline(i + 1)} className="accent-accent" /> parent {i + 1} <code className="text-accent">{p}</code>
              </label>
            ))}
          </div>
        </div>
      )}
      <div><FieldLabel>Commit message</FieldLabel><textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={cn(INPUT, 'h-auto resize-none py-1.5 font-mono')} /></div>
    </DialogShell>
  )
}

// ── Restore file preview ─────────────────────────────────────────────────────

export function RestoreFilePreviewDialog({ path, refLabel, content, busy, onClose, onConfirm }: {
  path: string
  refLabel: string
  content: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <DialogShell title="Restore file version" width="w-[560px]" icon={<AlertTriangle size={15} className="text-warning" />} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={onConfirm} disabled={busy} busy={busy}>Overwrite working copy</PrimaryBtn></>}>
      <div className="text-[11px] text-text-3">This will overwrite <span className="font-mono text-text-1">{path}</span> with its content at <span className="font-mono text-accent">{refLabel}</span>.</div>
      <pre className="max-h-64 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-2">{content || '(empty file at this commit)'}</pre>
    </DialogShell>
  )
}

// ── Generic text result (AI output, blame, raw output) ───────────────────────

export function TextResultDialog({ title, text, loading, onClose }: {
  title: string
  text: string
  loading: boolean
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }
  return (
    <DialogShell title={title} width="w-[640px]" onClose={onClose}
      footer={<><button onClick={copy} className="flex h-7 items-center gap-1.5 rounded border border-border-2 px-3 text-xs text-text-2 hover:bg-surface-2"><ClipboardCopy size={12} /> {copied ? 'Copied' : 'Copy'}</button><CancelBtn onClick={onClose} /></>}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-4"><Loader2 size={14} className="animate-spin" /> Working…</div>
      ) : (
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded border border-border-1 bg-surface-0 p-3 font-mono text-[11px] leading-relaxed text-text-2">{text}</pre>
      )}
    </DialogShell>
  )
}

// ── Generic single-input prompt ──────────────────────────────────────────────

export function PromptDialog({ title, label, placeholder, initial = '', busy, onClose, onSubmit }: {
  title: string
  label: string
  placeholder?: string
  initial?: string
  busy: boolean
  onClose: () => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <DialogShell title={title} onClose={onClose}
      footer={<><CancelBtn onClick={onClose} /><PrimaryBtn onClick={() => onSubmit(value.trim())} disabled={busy || !value.trim()} busy={busy}>OK</PrimaryBtn></>}>
      <div><FieldLabel>{label}</FieldLabel><input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(value.trim()) }} className={INPUT} placeholder={placeholder} /></div>
    </DialogShell>
  )
}
