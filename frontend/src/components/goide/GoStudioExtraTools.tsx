import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Play, Plus, Trash2 } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { detectGoIDEGoTool, installGoIDEGoModule, runGoIDEGoTool, type GoIDEGoToolInfo } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { GoStudioButton } from './GoStudioModal'
import { BUILTIN_EXTRA_TOOLS, addCustomTool, readCustomTools, removeCustomTool, splitArguments, type GoStudioExtraTool } from './goStudioExtraToolList'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** govulncheck, goimports, mockgen, stringer e i tool dell'utente: rilevamento, go install con conferma, esecuzione. */
export function GoStudioExtraTools({ sessionId, goAvailable, trusted }: { sessionId: string; goAvailable: boolean; trusted: boolean }) {
  const [custom, setCustom] = useState(readCustomTools)
  const [status, setStatus] = useState<Record<string, GoIDEGoToolInfo>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [args, setArgs] = useState('')
  const [directory, setDirectory] = useState('')
  const [draft, setDraft] = useState({ binary: '', module: '' })
  const [message, setMessage] = useState<string | null>(null)
  const tools = [...BUILTIN_EXTRA_TOOLS, ...custom]

  const detect = useCallback(async () => {
    const entries = await Promise.all([...BUILTIN_EXTRA_TOOLS, ...readCustomTools()].map(async (tool) => [tool.binary, await detectGoIDEGoTool(sessionId, tool.binary).catch(() => null)] as const))
    setStatus(Object.fromEntries(entries.filter((entry): entry is readonly [string, GoIDEGoToolInfo] => !!entry[1])))
  }, [sessionId])
  useEffect(() => { void detect() }, [detect, custom.length])

  const showRun = () => {
    useGoIDELspStore.getState().showToolWindow('run')
    setMessage('Running in the Run console; Health check again when an install finishes.')
  }

  const install = async (tool: GoStudioExtraTool) => {
    const approved = await confirm({ title: `Install ${tool.binary}?`, message: `go install ${tool.module} downloads the module and builds it into adOmnia's tools folder, with the project's Go SDK.`, confirmLabel: 'Install' })
    if (!approved) return
    try {
      await installGoIDEGoModule(sessionId, tool.module)
      showRun()
    } catch (error) {
      setMessage(errorText(error))
    }
  }

  const run = async (tool: GoStudioExtraTool) => {
    try {
      const execution = await runGoIDEGoTool(sessionId, tool.binary, splitArguments(args), directory.trim())
      useGoIDEStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [sessionId]: execution.id } }))
      setOpen(null)
      showRun()
    } catch (error) {
      setMessage(errorText(error))
    }
  }

  const add = () => {
    const error = addCustomTool({ binary: draft.binary.trim(), module: draft.module.trim(), purpose: 'Your tool', defaultArgs: '' })
    if (error) return setMessage(error)
    setDraft({ binary: '', module: '' })
    setCustom(readCustomTools())
    setMessage(null)
  }

  return (
    <section className="mt-4 space-y-2">
      <h4 className="gs-section-title">More Go tools</h4>
      <div className="gs-list">
        {tools.map((tool) => {
          const info = status[tool.binary]
          const healthy = info?.available === true
          return (
            <div key={tool.binary} className="gs-list-row flex-col items-stretch">
              <div className="flex items-center gap-3">
                {healthy ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <CircleAlert size={14} className="shrink-0 text-text-4" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-text-1">{tool.binary} <span className="font-normal text-text-4">· {tool.purpose}{healthy && info?.source ? ` (${info.source})` : ''}</span></div>
                  <div className="gs-mono truncate text-[11px] text-text-4" title={healthy ? info?.path : tool.module}>{healthy ? info?.path : tool.module || 'Not found on the PATH'}</div>
                </div>
                {tool.module && <GoStudioButton small variant="ghost" disabled={!goAvailable || !trusted} title={trusted ? `go install ${tool.module}` : 'Trust the project first'} onClick={() => void install(tool)}>{healthy ? 'Update…' : 'Install…'}</GoStudioButton>}
                <GoStudioButton small icon={Play} disabled={!healthy || !trusted} title={trusted ? 'Run with arguments' : 'Trust the project first'} onClick={() => { setOpen(open === tool.binary ? null : tool.binary); setArgs(tool.defaultArgs); setDirectory('') }}>Run…</GoStudioButton>
                {tool.custom && <GoStudioButton small variant="danger-ghost" className="gs-btn-icon" icon={Trash2} aria-label={`Remove ${tool.binary}`} title="Remove from the list" onClick={() => { removeCustomTool(tool.binary); setCustom(readCustomTools()) }} />}
              </div>
              {open === tool.binary && (
                <div className="mt-2 flex items-center gap-2 pl-[26px]">
                  <input autoFocus value={args} onChange={(event) => setArgs(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run(tool) }} aria-label={`${tool.binary} arguments`} placeholder="arguments" className="gs-input gs-mono min-w-0 flex-1" />
                  <input value={directory} onChange={(event) => setDirectory(event.target.value)} aria-label="Working directory" placeholder="folder (project root)" className="gs-input gs-mono w-44" />
                  <GoStudioButton small variant="primary" icon={Play} onClick={() => void run(tool)}>Run</GoStudioButton>
                </div>
              )}
            </div>
          )
        })}
        <div className="gs-list-row">
          <input value={draft.binary} onChange={(event) => setDraft({ ...draft, binary: event.target.value })} aria-label="Custom tool binary" placeholder="binary (e.g. air)" className="gs-input gs-mono w-36" />
          <input value={draft.module} onChange={(event) => setDraft({ ...draft, module: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && draft.binary.trim()) add() }} aria-label="Custom tool module" placeholder="module@version (optional)" className="gs-input gs-mono min-w-0 flex-1" />
          <GoStudioButton small icon={Plus} disabled={!draft.binary.trim()} onClick={add}>Add tool</GoStudioButton>
        </div>
      </div>
      {message && <p role="status" className="gs-hint">{message}</p>}
    </section>
  )
}
