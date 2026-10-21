import { useEffect, useState } from 'react'
import { Check, Loader2, Terminal } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import { getPythonInterpreters, installPythonTool, setPythonInterpreter, type GoIDEPythonInterpreter } from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import type { PythonInterpreterReport } from '../../../bindings/adomnia/internal/codestudio/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre la scelta dell'interprete Python del progetto. */
export function openPythonInterpreterDialog(sessionId: string): void {
  openRequest?.(sessionId)
}

/** Versione pinnata dello strumento di debug, la stessa che usa il backend. */
const DEBUGPY_PINNED = 'debugpy==1.8.22'

interface InterpreterRow {
  path: string
  title: string
  detail: string
  interpreter: GoIDEPythonInterpreter | null
}

/**
 * Interprete Python del progetto: Run, Debug e Test usano lo stesso interprete. Con il progetto
 * autorizzato si vedono versione e strumenti già installati (pytest, debugpy); debugpy si installa
 * solo dopo conferma del comando pip esatto, mai in automatico.
 */
export function CodeStudioPythonInterpreter() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [report, setReport] = useState<PythonInterpreterReport | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setReport(null)
      setError('')
      getPythonInterpreters(id).then(setReport).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [])

  const choose = async (path: string) => {
    if (!sessionId) return
    setBusy(path)
    try {
      await setPythonInterpreter(sessionId, '', path)
      setReport(await getPythonInterpreters(sessionId))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const install = async (interpreter: GoIDEPythonInterpreter) => {
    if (!sessionId) return
    const command = `${interpreter.path} -m pip install ${DEBUGPY_PINNED}`
    if (!window.confirm(`Install debugpy in this interpreter?\n\n${command}\n\nPackages may run their install scripts. Output appears in the Run console.`)) return
    setBusy(interpreter.path)
    try {
      await installPythonTool(sessionId, interpreter.path, 'debugpy', true)
      useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      useCodeStudioLspStore.getState().showToolWindow('run')
      setReport(await getPythonInterpreters(sessionId))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const rows: InterpreterRow[] = report
    ? [
      { path: '', title: 'Automatic (project environment or PATH)', detail: 'adOmnia picks the project environment, the activated one or PATH', interpreter: null },
      ...report.installed.map((interpreter): InterpreterRow => ({
        path: interpreter.path,
        title: interpreter.version ? `Python ${interpreter.version}` : 'Python',
        detail: `${interpreter.path} · ${interpreter.source}`,
        interpreter,
      })),
    ]
    : []

  return (
    <CodeStudioModal
      open={!!sessionId}
      onClose={() => setSessionId(null)}
      title="Project Python Interpreter"
      subtitle={report?.requiresPython ? `The project requires Python ${report.requiresPython}` : 'The project does not declare a Python version'}
      icon={Terminal}
      size="lg"
      divided
      flush
      top
    >
      <div className="gs-list max-h-[60vh] overflow-auto">
        {!report && !error && <p className="flex items-center gap-2 px-3 py-3 text-[11px] text-text-3"><Loader2 size={12} className="animate-spin" /> Looking for Python interpreters…</p>}
        {rows.map((row) => {
          const selected = (report?.selected ?? '') === row.path
          const interpreter = row.interpreter
          return (
            <div key={row.path || 'automatic'} className="gs-list-row">
              <button type="button" disabled={busy !== ''} onClick={() => void choose(row.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60">
                <span className="grid w-4 shrink-0 place-items-center text-success">{selected ? <Check size={13} /> : null}</span>
                <span className="w-64 shrink-0 text-[12px] text-text-1">{row.title}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-3">{row.detail}</span>
                {report?.probed && interpreter?.packages?.pytest && <span className="gs-badge shrink-0">pytest</span>}
                {report?.probed && interpreter?.packages?.debugpy && <span className="gs-badge shrink-0">debugpy</span>}
                {interpreter?.problem && <span className="gs-badge shrink-0 text-warning" title={interpreter.problem}>{interpreter.problem}</span>}
                {!report?.probed && interpreter && <span className="gs-badge shrink-0">not trusted</span>}
              </button>
              {report?.probed && interpreter && !interpreter.packages?.debugpy && (
                <div className="gs-row-actions">
                  <CodeStudioButton small variant="ghost" disabled={busy !== ''} onClick={() => void install(interpreter)}>Install debugpy…</CodeStudioButton>
                </div>
              )}
            </div>
          )
        })}
        {report && report.installed.length === 0 && <p className="px-3 py-3 text-[11px] text-text-4">No Python interpreter found. Install Python or set the PATH.</p>}
      </div>
      {error && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      <p className="border-t border-border-1 px-3 py-2 text-[10.5px] text-text-4">
        Saved in .adomnia/python.local.json (not shared via Git). Run, Debug and Test use the same interpreter.
        {!report?.probed && ' Trust the project to check versions and installed tools.'}
      </p>
    </CodeStudioModal>
  )
}
