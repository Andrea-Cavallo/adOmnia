import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, Play, Plus, Trash2 } from 'lucide-react'
import { confirm } from '@/lib/confirmDialog'
import { detectGoIDEGoTool, installGoIDEGoModule, runGoIDEGoTool, type GoIDEGoToolInfo } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
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
    <div className="mt-3">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-4">More Go tools</h4>
      <div className="divide-y divide-border-1 rounded border border-border-1 bg-surface-0">
        {tools.map((tool) => {
          const info = status[tool.binary]
          const healthy = info?.available === true
          return (
            <div key={tool.binary} className="p-2">
              <div className="flex items-center gap-3">
                {healthy ? <CheckCircle2 size={12} className="shrink-0 text-success" /> : <CircleAlert size={12} className="shrink-0 text-text-4" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-text-2">{tool.binary} <span className="font-normal text-text-4">· {tool.purpose}{healthy && info?.source ? ` (${info.source})` : ''}</span></div>
                  <div className="truncate font-mono text-[9px] text-text-4" title={healthy ? info?.path : tool.module}>{healthy ? info?.path : tool.module || 'Not found on the PATH'}</div>
                </div>
                {tool.module && <button type="button" disabled={!goAvailable || !trusted} title={trusted ? `go install ${tool.module}` : 'Trust the project first'} onClick={() => void install(tool)} className="h-6 rounded px-2 text-[10px] text-accent hover:bg-accent/10 disabled:text-text-4">{healthy ? 'Update…' : 'Install…'}</button>}
                <button type="button" disabled={!healthy || !trusted} title={trusted ? 'Run with arguments' : 'Trust the project first'} onClick={() => { setOpen(open === tool.binary ? null : tool.binary); setArgs(tool.defaultArgs); setDirectory('') }} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-text-2 hover:bg-surface-3 disabled:text-text-4"><Play size={10} /> Run…</button>
                {tool.custom && <button type="button" onClick={() => { removeCustomTool(tool.binary); setCustom(readCustomTools()) }} title="Remove from the list" className="grid h-6 w-6 place-items-center rounded text-text-4 hover:text-danger"><Trash2 size={11} /></button>}
              </div>
              {open === tool.binary && (
                <div className="mt-1.5 flex items-center gap-1.5 pl-5">
                  <input value={args} onChange={(event) => setArgs(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run(tool) }} aria-label={`${tool.binary} arguments`} placeholder="arguments" className="h-6 min-w-0 flex-1 rounded border border-border-1 bg-surface-1 px-2 font-mono text-[10.5px] text-text-1 outline-none focus:border-accent" />
                  <input value={directory} onChange={(event) => setDirectory(event.target.value)} aria-label="Working directory" placeholder="folder (project root)" className="h-6 w-36 rounded border border-border-1 bg-surface-1 px-2 font-mono text-[10.5px] text-text-1 outline-none focus:border-accent" />
                  <button type="button" onClick={() => void run(tool)} className="h-6 rounded bg-accent px-2.5 text-[10px] font-semibold text-white">Run</button>
                </div>
              )}
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 p-2">
          <input value={draft.binary} onChange={(event) => setDraft({ ...draft, binary: event.target.value })} aria-label="Custom tool binary" placeholder="binary (e.g. air)" className="h-6 w-32 rounded border border-border-1 bg-surface-1 px-2 font-mono text-[10.5px] text-text-1 outline-none focus:border-accent" />
          <input value={draft.module} onChange={(event) => setDraft({ ...draft, module: event.target.value })} aria-label="Custom tool module" placeholder="module@version (optional)" className="h-6 min-w-0 flex-1 rounded border border-border-1 bg-surface-1 px-2 font-mono text-[10.5px] text-text-1 outline-none focus:border-accent" />
          <button type="button" disabled={!draft.binary.trim()} onClick={add} className="flex h-6 items-center gap-1 rounded px-2 text-[10px] text-accent hover:bg-accent/10 disabled:text-text-4"><Plus size={10} /> Add tool</button>
        </div>
      </div>
      {message && <p role="status" className="mt-1 text-[9.5px] text-text-3">{message}</p>}
    </div>
  )
}
