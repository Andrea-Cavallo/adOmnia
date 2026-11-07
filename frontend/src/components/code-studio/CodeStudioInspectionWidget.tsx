import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { diagnosticCounts, mergedReports, useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { serverEntry, serverLanguageForEditor, useIdeLanguageServersStore } from '@/stores/ideLanguageServers'
import { ideLanguageForEditor, isLanguageServerEditorLanguage } from '@/components/ide/languages'
import { JAVA_LANGUAGE_ID } from '@/components/ide/languages/java'
import { isJavaOsgiProject } from '@/lib/code-studio-api'
import { runCodeStudioEditorCommand } from './codeStudioEditorRegistry'

interface CodeStudioInspectionWidgetProps {
  document: GoIDEEditorDocument
}

/** Report (gopls + linter) del solo file aperto: il widget parla di questo file, la status bar dell'intero progetto. */
function useFileCounts(sessionId: string, documentId: string, relativePath: string): { errors: number; warnings: number } {
  return useCodeStudioLspStore(useShallow((state) => {
    const reports = mergedReports(state.diagnostics[sessionId], state.lint[sessionId]?.reports)
    const own = Object.fromEntries(Object.entries(reports).filter(([, report]) => report.documentId === documentId || report.relativePath === relativePath))
    return diagnosticCounts(own)
  }))
}

const SERVER_OFF_REASON = 'Live error checking is not active: the language server of this file is not running, so no errors does not mean the file is correct.'
const OSGI_REASON = 'Live error checking of OSGi bundles needs a target platform (Java > OSGi Bundles & Target Platform) and the Java language server running. Java > Build OSGi Bundles gives the real compiler errors.'

/** Perché "nessun problema" qui non vuol dire che il file è corretto; null se il controllo è attivo. */
export function checkingOffReason(state: { osgiJavaFile: boolean; serverReady: boolean }): string | null {
  if (state.serverReady) return null
  return state.osgiJavaFile ? OSGI_REASON : SERVER_OFF_REASON
}

function useCheckingOffReason(sessionId: string, editorLanguage: string): string | null {
  const isJava = ideLanguageForEditor(editorLanguage)?.id === JAVA_LANGUAGE_ID
  const [osgiSession, setOsgiSession] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (isJava) void isJavaOsgiProject(sessionId).then((yes) => { if (!cancelled) setOsgiSession(yes ? sessionId : null) })
    return () => { cancelled = true }
  }, [isJava, sessionId])
  const language = serverLanguageForEditor(editorLanguage)
  const providedReady = useIdeLanguageServersStore((state) => !language || serverEntry(state, sessionId, language).state === 'ready')
  const goplsReady = useCodeStudioLspStore((state) => !!language || state.status[sessionId]?.state === 'ready')
  return checkingOffReason({ osgiJavaFile: isJava && osgiSession === sessionId, serverReady: providedReady && goplsReady })
}

/** Widget ispezioni in alto a destra dell'editor: stato del file a colpo d'occhio e salto tra i problemi. */
export function CodeStudioInspectionWidget({ document }: CodeStudioInspectionWidgetProps) {
  const { sessionId, id, relativePath, language } = document.document
  const { errors, warnings } = useFileCounts(sessionId, id, relativePath)
  const showToolWindow = useCodeStudioLspStore((state) => state.showToolWindow)
  const checkingOff = useCheckingOffReason(sessionId, language)
  if (!isLanguageServerEditorLanguage(language)) return null
  const clean = errors === 0 && warnings === 0
  const cleanLabel = checkingOff ?? 'No problems in this file'

  return (
    <div className="code-studio-inspection" role="status" aria-label={clean ? cleanLabel : `${errors} errors, ${warnings} warnings in this file`}>
      <button type="button" onClick={() => showToolWindow('problems')} title={checkingOff ?? 'Problems in this file · Alt+6'} className="flex h-6 items-center gap-2 rounded px-1.5 hover:bg-surface-3">
        {clean && !checkingOff && <Check size={13} className="text-success" aria-hidden="true" />}
        {clean && checkingOff && <span className="flex items-center gap-1 text-warning"><AlertTriangle size={13} aria-hidden="true" />Not checked</span>}
        {errors > 0 && <span className="flex items-center gap-1 text-danger"><AlertCircle size={13} aria-hidden="true" />{errors}</span>}
        {warnings > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle size={13} aria-hidden="true" />{warnings}</span>}
      </button>
      {!clean && (
        <>
          <button type="button" onClick={() => runCodeStudioEditorCommand('nav.previousProblem')} title="Previous problem · Shift+F8" aria-label="Previous problem" className="grid h-6 w-5 place-items-center rounded hover:bg-surface-3 hover:text-text-1"><ChevronUp size={13} /></button>
          <button type="button" onClick={() => runCodeStudioEditorCommand('nav.nextProblem')} title="Next problem · F8" aria-label="Next problem" className="grid h-6 w-5 place-items-center rounded hover:bg-surface-3 hover:text-text-1"><ChevronDown size={13} /></button>
        </>
      )}
    </div>
  )
}
