import { useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitCommitHorizontal, X } from 'lucide-react'
import { useModalFocusTrap } from '@/lib/accessibility'
import { getGoIDEFileAtRevision, getGoIDEFileHistory, type GoIDEVCSCommit } from '@/lib/goide-vcs-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'

interface GoStudioGitHistoryDialogProps {
  document: GoIDEEditorDocument | null
  open: boolean
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Cronologia Git del file: ogni commit si confronta con l'editor attuale (anche con modifiche non salvate). */
export function GoStudioGitHistoryDialog({ document, open, onClose }: GoStudioGitHistoryDialogProps) {
  const theme = useGoStudioEditorTheme()
  const [commits, setCommits] = useState<GoIDEVCSCommit[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const sessionId = document?.document.sessionId ?? ''
  const relativePath = document?.document.relativePath ?? ''

  useEffect(() => {
    if (!open || !document) return
    setError(null)
    setContent(null)
    getGoIDEFileHistory(sessionId, relativePath)
      .then((items) => { setCommits(items); setSelected(items[0]?.fullHash ?? null) })
      .catch((reason: unknown) => setError(errorMessage(reason)))
  }, [document, open, relativePath, sessionId])

  useEffect(() => {
    if (!open || !selected) return
    getGoIDEFileAtRevision(sessionId, relativePath, selected).then(setContent).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [open, relativePath, selected, sessionId])

  if (!open || !document) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Git history" tabIndex={-1} className="flex h-[min(620px,85vh)] w-[min(1000px,94vw)] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-1 px-4">
          <GitCommitHorizontal size={13} className="text-accent" />
          <h2 className="text-xs font-semibold text-text-1">Git History</h2>
          <span className="truncate font-mono text-[10px] text-text-4">{relativePath}</span>
          <button type="button" onClick={onClose} title="Close" className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="listbox" aria-label="Commits" className="w-72 shrink-0 overflow-auto border-r border-border-1 py-1">
            {commits.length === 0 && !error && <p className="px-3 py-3 text-[11px] text-text-4">This file has no commits yet.</p>}
            {commits.map((commit) => (
              <button key={commit.fullHash} type="button" role="option" aria-selected={commit.fullHash === selected} onClick={() => setSelected(commit.fullHash)}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left ${commit.fullHash === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2'}`}>
                <span className="w-full truncate text-[11px]">{commit.message}</span>
                <span className="text-[9px] text-text-4"><span className="font-mono">{commit.hash}</span> · {commit.author} · {commit.date}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {error && <p role="alert" className="p-3 text-[11px] text-danger">{error}</p>}
            {content !== null && (
              <DiffEditor original={content} modified={document.buffer} language={document.document.language} theme={theme} beforeMount={beforeGoStudioMount}
                originalModelPath={`inmemory://git-history/revision/${relativePath}`} modifiedModelPath={`inmemory://git-history/current/${relativePath}`}
                keepCurrentOriginalModel keepCurrentModifiedModel
                options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }} />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center border-t border-border-1 bg-surface-0 px-4 py-2 text-[10px] text-text-4">Left: selected commit · Right: current editor</div>
      </div>
    </div>
  )
}
