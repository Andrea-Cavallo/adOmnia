import { useEffect, useMemo, useState } from 'react'
import { Check, FileDiff, FileText, Loader2, Undo2 } from 'lucide-react'
import { GoStudioModal } from './GoStudioModal'
import { confirm } from '@/lib/confirmDialog'
import type { AgentReviewFile } from '@/lib/goide-api'
import { agentReviewHunks, agentReviewStats, type AgentReviewLine } from '@/lib/goide/agentReview'
import { useAgentReviewStore, pendingAgentFiles } from '@/stores/goideAgentReview'
import { useGoIDEStore } from '@/stores/goide'

const STATUS_LABEL: Record<string, { letter: string; title: string; className: string }> = {
  added: { letter: 'A', title: 'Created by the agent', className: 'text-success' },
  modified: { letter: 'M', title: 'Modified by the agent', className: 'text-warning' },
  deleted: { letter: 'D', title: 'Deleted by the agent', className: 'text-danger' },
}

/** Righe di un file nuovo o eliminato: un solo blocco, si decide sull'intero file. */
function wholeFileLines(file: AgentReviewFile): AgentReviewLine[] {
  const added = file.status === 'added'
  const text = added ? file.current : file.baseline
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  return lines.map((line, index) => added
    ? { kind: 'added', text: line, newNumber: index + 1 }
    : { kind: 'removed', text: line, oldNumber: index + 1 })
}

function DiffLines({ lines }: { lines: AgentReviewLine[] }) {
  return (
    <div className="font-mono text-[11px] leading-[18px]">
      {lines.map((line, index) => {
        const tone = line.kind === 'added' ? 'bg-success/10' : line.kind === 'removed' ? 'bg-danger/10' : ''
        const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '
        return (
          <div key={index} className={`flex whitespace-pre ${tone}`}>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-text-4">{line.oldNumber ?? ''}</span>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-text-4">{line.newNumber ?? ''}</span>
            <span className={`w-4 shrink-0 select-none ${line.kind === 'added' ? 'text-success' : line.kind === 'removed' ? 'text-danger' : 'text-text-4'}`}>{sign}</span>
            <span className="text-text-1">{line.text || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

function FileRow({ file, selected, onSelect }: { file: AgentReviewFile; selected: boolean; onSelect: () => void }) {
  const status = STATUS_LABEL[file.status] ?? STATUS_LABEL.modified
  const stats = useMemo(() => (file.reviewable && file.status === 'modified' ? agentReviewStats(file.baseline, file.current) : null), [file])
  const slash = file.path.lastIndexOf('/')
  return (
    <button type="button" onClick={onSelect} aria-current={selected} title={`${file.path} · ${status.title}`}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-3'}`}>
      <span className={`w-3 shrink-0 font-mono font-semibold ${status.className}`} aria-label={status.title}>{status.letter}</span>
      <span className="min-w-0 flex-1 truncate">
        {file.path.slice(slash + 1)}
        {slash > 0 && <span className="ml-1.5 text-[10px] text-text-4">{file.path.slice(0, slash)}</span>}
      </span>
      {stats && <span className="shrink-0 font-mono text-[10px]"><span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span></span>}
    </button>
  )
}

function FileReview({ root, file, busy }: { root: string; file: AgentReviewFile; busy: boolean }) {
  const store = useAgentReviewStore.getState()
  const hunks = useMemo(() => (file.reviewable && file.status === 'modified' ? agentReviewHunks(file.baseline, file.current) : []), [file])
  const canOpen = file.status !== 'deleted'

  const rejectFile = async () => {
    const what = file.status === 'added' ? `Delete ${file.path}, created by the agent?` : `Restore ${file.path} as it was before the agent?`
    if (await confirm({ title: 'Reject changes', message: what, confirmLabel: 'Reject', variant: 'danger' })) await store.rejectFile(root, file)
  }

  let body
  if (!file.reviewable) {
    body = <p className="p-4 text-[12px] text-text-3">This file is binary or larger than 1 MB, so its changes cannot be shown. Accept keeps it as it is; to undo it use Git or Local History.</p>
  } else if (file.status !== 'modified') {
    body = <DiffLines lines={wholeFileLines(file)} />
  } else if (hunks.length === 0) {
    body = <p className="p-4 text-[12px] text-text-3">Only line endings or the final newline changed.</p>
  } else {
    body = hunks.map(({ hunk, lines }) => (
      <section key={`${hunk.oldStart}-${hunk.newStart}`} className="border-b border-border-1" aria-label={`Change at line ${hunk.newStart}`}>
        <header className="sticky top-0 z-[1] flex items-center gap-2 bg-surface-2 px-3 py-1 text-[11px] text-text-3">
          <span className="font-mono">@@ {hunk.oldStart},{Math.max(0, hunk.oldEnd - hunk.oldStart + 1)} → {hunk.newStart},{Math.max(0, hunk.newEnd - hunk.newStart + 1)}</span>
          <span className="flex-1" />
          <button type="button" disabled={busy} onClick={() => void store.rejectHunk(root, file, hunk)} className="gs-btn gs-btn-secondary gs-btn-sm"><Undo2 size={12} />Reject</button>
          <button type="button" disabled={busy} onClick={() => void store.acceptHunk(root, file, hunk)} className="gs-btn gs-btn-primary gs-btn-sm"><Check size={12} />Accept</button>
        </header>
        <DiffLines lines={lines} />
      </section>
    ))
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border-1 px-3 py-2">
        <FileText size={14} className="shrink-0 text-text-3" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-1" title={file.path}>{file.path}</span>
        {file.agent && <span className="shrink-0 text-[10px] text-text-4">{file.agent}</span>}
        <button type="button" disabled={!canOpen} onClick={() => { store.close(); void useGoIDEStore.getState().openDocument(file.path) }} className="gs-btn gs-btn-ghost gs-btn-sm" title={canOpen ? 'Open in the editor' : 'The file was deleted'}>Open</button>
        <button type="button" disabled={busy} onClick={() => void rejectFile()} className="gs-btn gs-btn-secondary gs-btn-sm"><Undo2 size={12} />Reject file</button>
        <button type="button" disabled={busy} onClick={() => void store.acceptFile(root, file)} className="gs-btn gs-btn-primary gs-btn-sm"><Check size={12} />Accept file</button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-0">{body}</div>
    </div>
  )
}

/** Revisione delle modifiche fatte da milk o Claude Code: accetta o rifiuta per blocco, per file o tutto. */
export function GoStudioAgentReviewDialog() {
  const root = useAgentReviewStore((state) => state.dialogRoot)
  const files = useAgentReviewStore((state) => pendingAgentFiles(state, root ?? ''))
  const notice = useAgentReviewStore((state) => (root ? state.reviews[root]?.notice : undefined))
  const busy = useAgentReviewStore((state) => state.busy)
  const error = useAgentReviewStore((state) => state.error)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const store = useAgentReviewStore.getState()

  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null
  useEffect(() => { if (selected && selected.path !== selectedPath) setSelectedPath(selected.path) }, [selected, selectedPath])

  if (!root) return null

  const rejectAll = async () => {
    const created = files.filter((file) => file.status === 'added').length
    const ok = await confirm({
      title: 'Reject all agent changes',
      message: `Restore ${files.length} file${files.length === 1 ? '' : 's'} as they were before the agent${created ? ` and delete the ${created} it created` : ''}?`,
      confirmLabel: 'Reject all',
      variant: 'danger',
    })
    if (ok) await store.rejectAll(root)
  }

  return (
    <GoStudioModal
      open
      onClose={store.close}
      title="Review agent changes"
      subtitle={files.length ? `${files.length} file${files.length === 1 ? '' : 's'} changed by the agent and not reviewed yet` : 'Nothing left to review'}
      icon={FileDiff}
      size="full"
      tall
      divided
      flush
      actions={busy ? <Loader2 size={14} className="animate-spin text-text-3" aria-label="Working" /> : undefined}
      footerStart={(error || notice) && <span role="alert" className={`text-[11px] ${error ? 'text-danger' : 'text-warning'}`}>{error || notice}</span>}
      footer={files.length > 0 && (
        <>
          <button type="button" disabled={busy} onClick={() => void rejectAll()} className="gs-btn gs-btn-secondary"><Undo2 size={13} />Reject all</button>
          <button type="button" disabled={busy} onClick={() => void store.acceptAll(root)} className="gs-btn gs-btn-primary"><Check size={13} />Accept all</button>
        </>
      )}
    >
      {files.length === 0 ? (
        <div className="grid h-full place-items-center p-8 text-center text-[12px] text-text-3">
          <div>
            <Check size={28} className="mx-auto mb-2 text-success" />
            <p>Every change made by the agent has been reviewed.</p>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          <nav aria-label="Changed files" className="w-72 shrink-0 overflow-auto border-r border-border-1 p-2">
            {files.map((file) => <FileRow key={file.path} file={file} selected={file.path === selected?.path} onSelect={() => setSelectedPath(file.path)} />)}
          </nav>
          {selected && <FileReview root={root} file={selected} busy={busy} />}
        </div>
      )}
    </GoStudioModal>
  )
}
