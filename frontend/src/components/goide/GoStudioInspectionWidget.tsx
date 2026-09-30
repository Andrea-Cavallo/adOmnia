import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { GoIDEEditorDocument } from '@/stores/goide'
import { diagnosticCounts, mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { runGoStudioEditorCommand } from './goStudioEditorRegistry'

interface GoStudioInspectionWidgetProps {
  document: GoIDEEditorDocument
}

/** Report (gopls + linter) del solo file aperto: il widget parla di questo file, la status bar dell'intero progetto. */
function useFileCounts(sessionId: string, documentId: string, relativePath: string): { errors: number; warnings: number } {
  return useGoIDELspStore(useShallow((state) => {
    const reports = mergedReports(state.diagnostics[sessionId], state.lint[sessionId]?.reports)
    const own = Object.fromEntries(Object.entries(reports).filter(([, report]) => report.documentId === documentId || report.relativePath === relativePath))
    return diagnosticCounts(own)
  }))
}

/** Widget ispezioni in alto a destra dell'editor, come in IntelliJ: stato del file a colpo d'occhio e salto tra i problemi. */
export function GoStudioInspectionWidget({ document }: GoStudioInspectionWidgetProps) {
  const { sessionId, id, relativePath, language } = document.document
  const { errors, warnings } = useFileCounts(sessionId, id, relativePath)
  const showToolWindow = useGoIDELspStore((state) => state.showToolWindow)
  if (language !== 'go') return null
  const clean = errors === 0 && warnings === 0

  return (
    <div className="go-studio-inspection" role="status" aria-label={clean ? 'No problems in this file' : `${errors} errors, ${warnings} warnings in this file`}>
      <button type="button" onClick={() => showToolWindow('problems')} title="Problems in this file · Alt+6" className="flex h-6 items-center gap-2 rounded px-1.5 hover:bg-surface-3">
        {clean && <Check size={13} className="text-success" aria-hidden="true" />}
        {errors > 0 && <span className="flex items-center gap-1 text-danger"><AlertCircle size={13} aria-hidden="true" />{errors}</span>}
        {warnings > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle size={13} aria-hidden="true" />{warnings}</span>}
      </button>
      {!clean && (
        <>
          <button type="button" onClick={() => runGoStudioEditorCommand('nav.previousProblem')} title="Previous problem · Shift+F8" aria-label="Previous problem" className="grid h-6 w-5 place-items-center rounded hover:bg-surface-3 hover:text-text-1"><ChevronUp size={13} /></button>
          <button type="button" onClick={() => runGoStudioEditorCommand('nav.nextProblem')} title="Next problem · F8" aria-label="Next problem" className="grid h-6 w-5 place-items-center rounded hover:bg-surface-3 hover:text-text-1"><ChevronDown size={13} /></button>
        </>
      )}
    </div>
  )
}
