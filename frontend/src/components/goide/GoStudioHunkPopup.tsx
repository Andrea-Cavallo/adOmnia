import { useEffect, useRef, useState } from 'react'
import { ListChecks, RotateCcw, X } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { headKey, useGoIDEVCSStore } from '@/stores/goideVcs'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { hunkOldLines } from '@/lib/goide/goStudioLineDiff'
import { editorModelUri } from './goStudioModelUri'
import './goStudioModal.css'
import { revertHunk } from './goStudioVcsEditor'
import { applyGoStudioHunkToIndex, type GoStudioHunkStageMode } from './goStudioVcsHunkStage'
import { HunkStageDialog } from '@/components/workspace/git/HunkStageDialog'

const POPUP_WIDTH = 520
const MAX_PREVIEW_LINES = 40

/** Popup del blocco modificato: righe di HEAD, Revert, e stage/unstage del blocco sull'index Git. */
export function GoStudioHunkPopup() {
  const popup = useGoIDEVCSStore((state) => state.hunkPopup)
  const document = useGoIDEStore((state) => (popup ? state.documents.find((item) => item.document.id === popup.documentId) ?? null : null))
  const headText = useGoIDEVCSStore((state) => (document ? state.head[headKey(document.document.sessionId, document.document.relativePath)] : undefined))
  const repoRoot = useGoIDEVCSStore((state) => (document ? state.status[document.document.sessionId]?.repoRoot ?? '' : ''))
  const ref = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<GoStudioHunkStageMode | null>(null)
  const [busy, setBusy] = useState(false)
  const close = () => useGoIDEVCSStore.getState().showHunk(null)

  useEffect(() => {
    if (!popup) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !lines) close() }
    // Con la finestra delle righe aperta i clic finiscono lì, non chiudono il popup.
    const onPointer = (event: MouseEvent) => { if (!lines && !ref.current?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onPointer), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onPointer); window.clearTimeout(timer) }
  }, [popup, lines])

  if (!popup || !document || typeof headText !== 'string') return null
  const oldLines = hunkOldLines(headText, popup.hunk)
  const left = Math.min(popup.anchor.x + 8, window.innerWidth - POPUP_WIDTH - 8)
  const revert = () => {
    const editor = activeGoStudioEditor()
    if (editor?.getModel()?.uri.toString() === editorModelUri(document.document)) revertHunk(editor, popup.hunk, headText)
    close()
  }
  /** Stage/unstage del blocco: prima il buffer su disco, poi i blocchi sull'index. */
  const stage = async (mode: GoStudioHunkStageMode) => {
    if (busy) return
    setBusy(true)
    const { sessionId, relativePath, path, id } = document.document
    try {
      if (document.dirty) await useGoIDEStore.getState().saveDocument(id)
      const count = await applyGoStudioHunkToIndex(sessionId, path, popup.hunk, mode)
      useGoIDELspStore.setState({
        message: count > 0
          ? `${mode === 'stage' ? 'Staged' : 'Unstaged'} ${count} change block${count === 1 ? '' : 's'} in ${relativePath}.`
          : `Nothing to ${mode} in ${relativePath}: this change is already ${mode === 'stage' ? 'in the index' : 'out of the index'}.`,
      })
      await useGoIDEVCSStore.getState().refreshStatus(sessionId)
    } catch (reason) {
      useGoIDELspStore.setState({ message: `${mode === 'stage' ? 'Stage' : 'Unstage'} failed: ${reason instanceof Error ? reason.message : String(reason)}` })
    } finally {
      setBusy(false)
      close()
    }
  }
  const title = popup.hunk.kind === 'added' ? 'Added lines (not in HEAD)' : popup.hunk.kind === 'modified' ? 'HEAD version of these lines' : 'Lines deleted since HEAD'

  return (
    <div ref={ref} role="dialog" aria-label="Change since HEAD" style={{ left, top: popup.anchor.y + 8, width: POPUP_WIDTH }} className="gs-popover">
      <div className="gs-popover-header">
        <span className="font-semibold text-text-1">{title}</span>
        <button type="button" onClick={() => void stage('stage')} disabled={busy || document.document.readOnly} title="Move this change block into the Git index" className="ml-auto flex h-6 items-center gap-1 rounded px-2 text-text-2 hover:bg-surface-3 disabled:opacity-40"><ListChecks size={11} /> Stage</button>
        <button type="button" onClick={() => void stage('unstage')} disabled={busy || document.document.readOnly} title="Move this change block back out of the Git index" className="flex h-6 items-center gap-1 rounded px-2 text-text-2 hover:bg-surface-3 disabled:opacity-40">Unstage</button>
        <button type="button" onClick={revert} disabled={document.document.readOnly} className="flex h-6 items-center gap-1 rounded px-2 text-text-2 hover:bg-surface-3 disabled:opacity-40"><RotateCcw size={11} /> Revert</button>
        <button type="button" onClick={close} title="Close · Esc" aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={11} /></button>
      </div>
      <div className="max-h-64 overflow-auto bg-surface-0 py-1 font-mono text-[10px] leading-4">
        {oldLines.length === 0 && <p className="px-3 py-1 font-sans text-text-4">These lines do not exist in HEAD. Revert removes them.</p>}
        {oldLines.slice(0, MAX_PREVIEW_LINES).map((line, index) => (
          <div key={index} className="whitespace-pre px-3 text-text-2"><span className="mr-3 inline-block w-8 select-none text-right text-text-4">{popup.hunk.oldStart + index}</span>{line || ' '}</div>
        ))}
        {oldLines.length > MAX_PREVIEW_LINES && <p className="px-3 text-text-4">… {oldLines.length - MAX_PREVIEW_LINES} more lines</p>}
      </div>
      <div className="flex items-center gap-3 border-t border-border-1 px-3 py-1.5 text-[10.5px] text-text-4">
        <button type="button" onClick={() => setLines('stage')} className="underline-offset-2 hover:text-text-2 hover:underline">Stage single lines…</button>
        <button type="button" onClick={() => setLines('unstage')} className="underline-offset-2 hover:text-text-2 hover:underline">Unstage single lines…</button>
      </div>
      {lines && (
        <HunkStageDialog
          repoPath={repoRoot}
          path={document.document.path}
          mode={lines}
          onDone={() => { void useGoIDEVCSStore.getState().refreshStatus(document.document.sessionId) }}
          onClose={() => setLines(null)}
        />
      )}
    </div>
  )
}
