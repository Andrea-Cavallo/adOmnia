import { useEffect, useState } from 'react'
import { Check, Loader2, Terminal } from 'lucide-react'
import { CodeStudioButton, CodeStudioModal } from './CodeStudioModal'
import {
  createPythonEnvironment,
  getPythonEnvironment,
  getPythonInterpreters,
  installPythonDependencies,
  installPythonTool,
  setPythonInterpreter,
  type GoIDEPythonEnvironment,
  type GoIDEPythonInterpreter,
} from '@/lib/code-studio-api'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import type { PythonInterpreterReport } from '../../../bindings/adomnia/internal/codestudio/models'

let openRequest: ((sessionId: string) => void) | null = null

/** Apre la scelta dell'interprete Python del progetto. */
export function openPythonInterpreterDialog(sessionId: string): void {
  openRequest?.(sessionId)
}

/** Versioni pinnate degli strumenti installabili, le stesse che usa il backend. */
const INSTALLABLE_TOOLS = [
  { id: 'debugpy', label: 'debugpy', pinned: 'debugpy==1.8.22', why: 'needed to debug Python code' },
  { id: 'ruff', label: 'Ruff', pinned: 'ruff==0.13.2', why: 'formats Python files; basedpyright does not format' },
] as const

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
  const [plan, setPlan] = useState<GoIDEPythonEnvironment | null>(null)
  const [manualPath, setManualPath] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async (id: string) => {
    const [nextReport, nextPlan] = await Promise.all([
      getPythonInterpreters(id),
      getPythonEnvironment(id, ''),
    ])
    setReport(nextReport)
    setPlan(nextPlan)
  }

  useEffect(() => {
    openRequest = (id) => {
      setSessionId(id)
      setReport(null)
      setPlan(null)
      setManualPath('')
      setError('')
      load(id).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
    }
    return () => { openRequest = null }
  }, [])

  const choose = async (path: string) => {
    if (!sessionId) return
    setBusy(path || 'automatic')
    try {
      await setPythonInterpreter(sessionId, '', path)
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const install = async (interpreter: GoIDEPythonInterpreter, tool: typeof INSTALLABLE_TOOLS[number]) => {
    if (!sessionId) return
    const command = `${interpreter.path} -m pip install ${tool.pinned}`
    if (!window.confirm(`Install ${tool.label} in this interpreter?\n\n${command}\n\n${tool.why}. Packages may run their install scripts. Output appears in the Run console.`)) return
    setBusy(`${interpreter.path}:${tool.id}`)
    try {
      await installPythonTool(sessionId, interpreter.path, tool.id, true)
      useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      useCodeStudioLspStore.getState().showToolWindow('run')
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  // createEnvironment e installDependencies mostrano il comando esatto prima di partire: nessuna
  // azione implicita sul progetto (PY-2.3/2.4).
  const createEnvironment = async () => {
    if (!sessionId || !plan?.create.command) return
    if (!window.confirm(`Create the project environment?\n\n${plan.create.command}\n\nPython packages are not downloaded here.`)) return
    setBusy('create')
    try {
      await createPythonEnvironment(sessionId, plan.root ?? '', plan.create.executable ?? '', true)
      useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      useCodeStudioLspStore.getState().showToolWindow('run')
      await load(sessionId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const installDependencies = async () => {
    if (!sessionId || !plan?.install.command) return
    if (!window.confirm(`Install the project dependencies?\n\n${plan.install.command}\n\nThe command runs in the project environment. Output appears in the Run console.`)) return
    setBusy('install')
    try {
      await installPythonDependencies(sessionId, plan.root ?? '', true)
      useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      useCodeStudioLspStore.getState().showToolWindow('run')
      await load(sessionId)
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
        detail: [interpreter.path, interpreter.source, interpreter.architecture].filter(Boolean).join(' · '),
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
                {report?.probed && interpreter?.packages?.basedpyright && <span className="gs-badge shrink-0">basedpyright</span>}
                {report?.probed && interpreter?.packages?.ruff && <span className="gs-badge shrink-0">ruff</span>}
                {report?.probed && interpreter?.packages?.uvicorn && <span className="gs-badge shrink-0">uvicorn</span>}
                {report?.probed && interpreter?.packages?.flask && <span className="gs-badge shrink-0">flask</span>}
                {report?.probed && interpreter?.packages?.django && <span className="gs-badge shrink-0">django</span>}
                {interpreter?.problem && <span className="gs-badge shrink-0 text-warning" title={interpreter.problem}>{interpreter.problem}</span>}
                {!report?.probed && interpreter && <span className="gs-badge shrink-0">not trusted</span>}
              </button>
              {report?.probed && interpreter && INSTALLABLE_TOOLS.some((tool) => !interpreter.packages?.[tool.id]) && (
                <div className="gs-row-actions">
                  {INSTALLABLE_TOOLS.filter((tool) => !interpreter.packages?.[tool.id]).map((tool) => (
                    <CodeStudioButton key={tool.id} small variant="ghost" disabled={busy !== ''} title={tool.pinned} onClick={() => void install(interpreter, tool)}>Install {tool.label}…</CodeStudioButton>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {report && report.installed.length === 0 && <p className="px-3 py-3 text-[11px] text-text-4">No Python interpreter found. Install Python or set the PATH.</p>}
      </div>
      <div className="border-t border-border-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            aria-label="Interpreter path"
            value={manualPath}
            onChange={(event) => setManualPath(event.target.value)}
            placeholder="C:\\Python312\\python.exe"
            className="gs-input min-w-0 flex-1 font-mono text-[11px]"
          />
          <CodeStudioButton small variant="ghost" disabled={busy !== '' || manualPath.trim() === ''} onClick={() => void choose(manualPath.trim())}>
            Use this path
          </CodeStudioButton>
        </div>
        {plan && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-text-4">
            <span className="text-text-3">
              {plan.manager ? `${plan.manager} project` : 'no dependency file'}
              {plan.lockfile ? ` · ${plan.lockfile}` : ''}
              {plan.pythonVersion ? ` · ${plan.pythonVersion}` : ''}
            </span>
            <span className="truncate font-mono">{plan.environment ? plan.environment : 'no environment'}</span>
            <CodeStudioButton small variant="ghost" disabled={busy !== '' || !plan.create.available} onClick={() => void createEnvironment()} title={plan.create.reason}>
              {busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : null} Create environment…
            </CodeStudioButton>
            <CodeStudioButton small variant="ghost" disabled={busy !== '' || !plan.install.available} onClick={() => void installDependencies()} title={plan.install.reason}>
              {busy === 'install' ? <Loader2 size={12} className="animate-spin" /> : null} Install dependencies…
            </CodeStudioButton>
          </div>
        )}
        {plan && !plan.create.available && plan.create.reason && <p className="mt-1 text-[10.5px] text-text-4">{plan.create.reason}</p>}
        {plan && !plan.install.available && plan.install.reason && <p className="mt-1 text-[10.5px] text-text-4">{plan.install.reason}</p>}
      </div>
      {error && <p className="border-t border-border-1 px-3 py-2 text-[11px] text-danger">{error}</p>}
      <p className="border-t border-border-1 px-3 py-2 text-[10.5px] text-text-4">
        Saved in .adomnia/python.local.json (not shared via Git). Run, Debug and Test use the same interpreter.
        {!report?.probed && ' Trust the project to check versions and installed tools.'}
      </p>
    </CodeStudioModal>
  )
}
