import { useEffect, useState } from 'react'
import { Activity, Flame, Play, Square } from 'lucide-react'
import { useGoIDEStore } from '@/stores/goide'
import { listGoIDEProfileFiles, listGoIDETraceFiles, type GoIDESession } from '@/lib/goide-api'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'

const KINDS = { cpu: 'CPU', mem: 'Memory', block: 'Block', mutex: 'Mutex' } as const
type Kind = keyof typeof KINDS

export function GoStudioCreateProfile({ session, onCreated, capture = 'profile' }: { session: GoIDESession; onCreated: (path: string) => void; capture?: 'profile' | 'trace' }) {
  const trace = capture === 'trace'
  const artifact = trace ? 'trace.out' : '.pprof'
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('cpu')
  const [target, setTarget] = useState('.')
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [pending, setPending] = useState<{ id: string; path: string } | null>(null)
  const execution = useGoIDEStore((state) => state.executions.find((item) => item.id === pending?.id))
  const authorized = session.project.authorization === 'tooling-permitted'

  useEffect(() => {
    if (!pending || !execution || execution.status === 'running') return
    let cancelled = false
    const listFiles = trace ? listGoIDETraceFiles : listGoIDEProfileFiles
    void listFiles(session.id).then((files) => {
      if (cancelled) return
      setPending(null)
      if (files.some((file) => file.relative === pending.path)) {
        onCreated(pending.path)
        if (execution.status !== 'exited') setError(`${artifact} saved, but the tests did not complete successfully. See Run output.`)
      } else {
        setError(execution.error || `No ${artifact} generated. Check that the package contains tests and inspect the Run output.`)
      }
    }).catch((problem: unknown) => {
      if (!cancelled) { setPending(null); setError(problem instanceof Error ? problem.message : `Could not find the generated ${artifact}.`) }
    })
    return () => { cancelled = true }
  }, [execution, pending, session.id, onCreated, trace, artifact])

  const create = async () => {
    const packagePath = target.trim().replace(/\\/g, '/')
    if (!/^(\.|\.\/[\w./-]+)$/.test(packagePath) || packagePath.includes('..')) {
      setError('Choose one local package, for example . or ./mypackage.')
      return
    }
    if (useGoIDEStore.getState().activeSessionId !== session.id) return
    setStarting(true)
    setError(null)
    const path = trace ? `trace-${Date.now()}.out` : `${kind}-${Date.now()}.pprof`
    const flag = trace ? 'trace' : { cpu: 'cpuprofile', mem: 'memprofile', block: 'blockprofile', mutex: 'mutexprofile' }[kind]
    await useGoIDEStore.getState().startRun('test', {
      target: packagePath,
      workingDirectory: '',
      goArguments: ['-count=1', `-${flag}=${path}`],
    })
    const state = useGoIDEStore.getState()
    setStarting(false)
    if (state.error) { setError(state.error); return }
    const id = state.activeRunBySession[session.id]
    if (id) { setPending({ id, path }); setOpen(false) }
  }

  return (
    <>
      <GoStudioButton small icon={Play} disabled={!authorized || starting || !!pending} onClick={() => setOpen(true)}>
        {pending ? `Creating ${artifact}…` : `Create ${artifact}`}
      </GoStudioButton>
      {pending && <GoStudioButton small icon={Square} onClick={() => void useGoIDEStore.getState().stopRun(pending.id)}>Stop</GoStudioButton>}
      {error && !open && <span role="alert" className="text-[11px] text-danger">{error}</span>}
      <GoStudioModal open={open} onClose={() => { if (!starting) setOpen(false) }} title={`Create ${artifact}`} icon={trace ? Activity : Flame} size="sm"
        subtitle={`Run package tests and save a ${trace ? 'trace' : 'profile'} in the project root.`}
        footer={<><GoStudioButton disabled={starting} onClick={() => setOpen(false)}>Cancel</GoStudioButton><GoStudioButton variant="primary" icon={Play} loading={starting} disabled={!authorized || starting} onClick={() => void create()}>Run and create {trace ? 'trace' : 'profile'}</GoStudioButton></>}>
        <div className="flex flex-col gap-4">
          {!trace && <GoStudioField label="Profile type"><select className="gs-input" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>{Object.entries(KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></GoStudioField>}
          <GoStudioField label="Package" hint="One package with Go tests. Use . for the project root."><input className="gs-input gs-mono" value={target} onChange={(event) => setTarget(event.target.value)} /></GoStudioField>
          <p className="text-xs text-text-3">A new file is saved for each capture and opened automatically when the tests finish.</p>
          {error && <GoStudioAlert>{error}</GoStudioAlert>}
        </div>
      </GoStudioModal>
    </>
  )
}
