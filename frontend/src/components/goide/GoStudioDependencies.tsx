import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, PackagePlus, RefreshCw, Trash2, X } from 'lucide-react'
import { listGoIDEDependencies, startGoIDEDependencyAction, type GoIDEDependencyState, type GoIDESession } from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'

interface GoStudioDependenciesProps {
  open: boolean
  session: GoIDESession
  onClose: () => void
}

export function GoStudioDependencies({ open, session, onClose }: GoStudioDependenciesProps) {
  const [moduleDirectory, setModuleDirectory] = useState(session.project.modules[0]?.path ?? '')
  const [state, setState] = useState<GoIDEDependencyState | null>(null)
  const [modulePath, setModulePath] = useState('')
  const [version, setVersion] = useState('latest')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const executions = useGoIDEStore((store) => store.executions)
  const updateLayout = useGoIDEStore((store) => store.updateLayout)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  const lastDependencyRun = useMemo(() => executions.filter((execution) => execution.sessionId === session.id && execution.kind === 'dependency').sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null, [executions, session.id])

  const load = async (directory = moduleDirectory) => {
    if (!directory) return
    setLoading(true); setError(null)
    try { setState(await listGoIDEDependencies(session.id, directory)) } catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (!open) return
    const directory = session.project.modules[0]?.path ?? ''
    setModuleDirectory(directory)
    setState(null)
    if (directory) void load(directory)
  }, [open, session.id])

  useEffect(() => {
    if (open && lastDependencyRun && lastDependencyRun.status !== 'running') void load()
  }, [lastDependencyRun?.status])

  if (!open) return null

  const execute = async (action: 'add' | 'update' | 'remove', path: string, selectedVersion: string) => {
    const suffix = action === 'remove' ? '@none' : `@${selectedVersion || 'latest'}`
    const approved = await confirm({ title: `${action === 'remove' ? 'Remove' : action === 'add' ? 'Add' : 'Update'} dependency?`, message: `Command: go get ${path}${suffix}\nWorking directory: ${moduleDirectory}\n\nThis may contact the configured Go proxy and will update go.mod/go.sum.`, confirmLabel: `Run go get`, variant: action === 'remove' ? 'danger' : 'default' })
    if (!approved) return
    try {
      await startGoIDEDependencyAction({ sessionId: session.id, moduleDirectory, action, modulePath: path, version: selectedVersion, confirmed: true })
      updateLayout({ bottomOpen: true })
      if (action === 'add') { setModulePath(''); setVersion('latest') }
    } catch (reason) { setError(String(reason)) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Go dependencies" tabIndex={-1} className="flex max-h-[78vh] w-[680px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">Go dependencies</h2><span className="ml-2 text-[9px] text-text-4">explicit go get actions</span><button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {error && <div role="alert" className="mb-3 rounded border border-danger/30 bg-danger/10 p-2 text-[10px] text-danger">{error}</div>}
          {session.project.modules.length === 0 ? <div className="rounded border border-border-1 bg-surface-0 p-4 text-[11px] text-text-3">This project has no Go module. Create or open a folder containing go.mod before managing dependencies.</div> : <>
            <div className="mb-3 flex items-end gap-2"><label className="min-w-0 flex-1 text-[10px] text-text-3">Module<select value={moduleDirectory} onChange={(event) => { setModuleDirectory(event.target.value); void load(event.target.value) }} className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1">{session.project.modules.map((module) => <option key={module.path} value={module.path}>{module.modulePath || module.path}</option>)}</select></label><button type="button" disabled={loading} onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded border border-border-1 text-text-3 hover:border-accent disabled:opacity-40">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button></div>
            {state && <div className="mb-3 flex gap-4 rounded border border-border-1 bg-surface-0 px-3 py-2 text-[9px] text-text-4"><span>module <strong className="font-mono text-text-2">{state.modulePath}</strong></span><span>go.sum <strong className={state.goSumPresent ? 'text-success' : 'text-text-3'}>{state.goSumPresent ? 'present' : 'not present'}</strong></span><span>{state.dependencies.length} requirements</span></div>}
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border-1 bg-surface-0">{state?.dependencies.length === 0 && <p className="p-3 text-[10px] text-text-4">No requirements in this go.mod.</p>}{state?.dependencies.map((dependency) => <div key={dependency.path} className="group flex items-center gap-2 border-b border-border-1 px-3 py-2 last:border-b-0"><div className="min-w-0 flex-1"><div className="truncate font-mono text-[10px] text-text-2">{dependency.path}</div><div className="text-[9px] text-text-4">{dependency.version}{dependency.indirect ? ' · indirect' : ''}</div></div><button type="button" onClick={() => void execute('update', dependency.path, 'latest')} className="h-6 rounded px-2 text-[9px] text-accent opacity-0 hover:bg-accent/10 group-hover:opacity-100">Update</button><button type="button" title="Remove dependency" onClick={() => void execute('remove', dependency.path, '')} className="grid h-6 w-6 place-items-center rounded text-text-4 opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100"><Trash2 size={10} /></button></div>)}</div>
            <div className="mt-3 grid grid-cols-[1fr_130px_auto] gap-2 border-t border-border-1 pt-3"><label className="text-[9px] text-text-4">Module path<input value={modulePath} onChange={(event) => setModulePath(event.target.value)} placeholder="github.com/example/pkg" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent" /></label><label className="text-[9px] text-text-4">Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="latest" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1 outline-none focus:border-accent" /></label><button type="button" disabled={!modulePath || lastDependencyRun?.status === 'running'} onClick={() => void execute('add', modulePath, version)} className="mt-4 flex h-8 items-center gap-1.5 rounded bg-accent px-3 text-[10px] font-semibold text-white disabled:opacity-40"><PackagePlus size={11} /> Add…</button></div>
          </>}
        </div>
      </div>
    </div>
  )
}
