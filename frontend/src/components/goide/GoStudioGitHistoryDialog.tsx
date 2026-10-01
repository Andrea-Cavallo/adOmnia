import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { getGoIDEFileAtRevision, getGoIDEFileHistory, type GoIDEVCSCommit } from '@/lib/goide-vcs-api'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { GoStudioAlert, GoStudioButton, GoStudioModal } from './GoStudioModal'

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
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="full"
      tall
      divided
      flush
      icon={GitCommitHorizontal}
      title="Git history"
      subtitle={<span className="gs-mono">{relativePath}</span>}
      footerStart="Left: selected commit · Right: current editor"
      footer={<GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>}
    >
      <div className="flex min-h-0 flex-1">
        <div role="listbox" aria-label="Commits" className="w-80 shrink-0 overflow-auto border-r border-border-1 p-1.5">
          {commits.length === 0 && !error && <p className="gs-list-empty">This file has no commits yet.</p>}
          {commits.map((commit) => (
            <button key={commit.fullHash} type="button" role="option" aria-selected={commit.fullHash === selected} onClick={() => setSelected(commit.fullHash)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left ${commit.fullHash === selected ? 'bg-accent/15 text-text-1' : 'text-text-2 hover:bg-surface-2/60'}`}>
              <span className="w-full truncate text-[12.5px] font-medium">{commit.message}</span>
              <span className="text-[11.5px] text-text-4"><span className="gs-mono text-[11px]">{commit.hash}</span> · {commit.author} · {commit.date}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {error && <div className="p-4"><GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert></div>}
          {content !== null && (
            <DiffEditor original={content} modified={document.buffer} language={document.document.language} theme={theme} beforeMount={beforeGoStudioMount}
              originalModelPath={`inmemory://git-history/revision/${relativePath}`} modifiedModelPath={`inmemory://git-history/current/${relativePath}`}
              keepCurrentOriginalModel keepCurrentModifiedModel
              options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12.5 }} />
          )}
        </div>
      </div>
    </GoStudioModal>
  )
}
