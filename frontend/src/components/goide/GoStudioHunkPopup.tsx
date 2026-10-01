import { useEffect, useRef } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { headKey, useGoIDEVCSStore } from '@/stores/goideVcs'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { hunkOldLines } from './goStudioLineDiff'
import { editorModelUri } from './goStudioModelUri'
import './goStudioModal.css'
import { revertHunk } from './goStudioVcsEditor'

const POPUP_WIDTH = 520
const MAX_PREVIEW_LINES = 40

/** Popup del blocco modificato: mostra le righe di HEAD e le rimette nel buffer con Revert. */
export function GoStudioHunkPopup() {
  const popup = useGoIDEVCSStore((state) => state.hunkPopup)
  const document = useGoIDEStore((state) => (popup ? state.documents.find((item) => item.document.id === popup.documentId) ?? null : null))
  const headText = useGoIDEVCSStore((state) => (document ? state.head[headKey(document.document.sessionId, document.document.relativePath)] : undefined))
  const ref = useRef<HTMLDivElement>(null)
  const close = () => useGoIDEVCSStore.getState().showHunk(null)

  useEffect(() => {
    if (!popup) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onPointer = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onPointer), 0)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onPointer); window.clearTimeout(timer) }
  }, [popup])

  if (!popup || !document || typeof headText !== 'string') return null
  const oldLines = hunkOldLines(headText, popup.hunk)
  const left = Math.min(popup.anchor.x + 8, window.innerWidth - POPUP_WIDTH - 8)
  const revert = () => {
    const editor = activeGoStudioEditor()
    if (editor?.getModel()?.uri.toString() === editorModelUri(document.document)) revertHunk(editor, popup.hunk, headText)
    close()
  }
  const title = popup.hunk.kind === 'added' ? 'Added lines (not in HEAD)' : popup.hunk.kind === 'modified' ? 'HEAD version of these lines' : 'Lines deleted since HEAD'

  return (
    <div ref={ref} role="dialog" aria-label="Change since HEAD" style={{ left, top: popup.anchor.y + 8, width: POPUP_WIDTH }} className="gs-popover">
      <div className="gs-popover-header">
        <span className="font-semibold text-text-1">{title}</span>
        <button type="button" onClick={revert} disabled={document.document.readOnly} className="ml-auto flex h-6 items-center gap-1 rounded px-2 text-text-2 hover:bg-surface-3 disabled:opacity-40"><RotateCcw size={11} /> Revert</button>
        <button type="button" onClick={close} title="Close · Esc" aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={11} /></button>
      </div>
      <div className="max-h-64 overflow-auto bg-surface-0 py-1 font-mono text-[10px] leading-4">
        {oldLines.length === 0 && <p className="px-3 py-1 font-sans text-text-4">These lines do not exist in HEAD. Revert removes them.</p>}
        {oldLines.slice(0, MAX_PREVIEW_LINES).map((line, index) => (
          <div key={index} className="whitespace-pre px-3 text-text-2"><span className="mr-3 inline-block w-8 select-none text-right text-text-4">{popup.hunk.oldStart + index}</span>{line || ' '}</div>
        ))}
        {oldLines.length > MAX_PREVIEW_LINES && <p className="px-3 text-text-4">… {oldLines.length - MAX_PREVIEW_LINES} more lines</p>}
      </div>
    </div>
  )
}
