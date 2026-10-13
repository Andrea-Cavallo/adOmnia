import { useState } from 'react'
import { Boxes, Gauge, Play, Wrench } from 'lucide-react'
import type { GoIDESession } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { detectGoIDEGoTool, installGoIDEGoModule, runGoIDEGoTool } from '@/lib/goide-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { goModules } from '@/lib/goide/goProject'
import { GoStudioProfilePanel } from './GoStudioProfilePanel'
import { GoStudioExtraTools } from './GoStudioExtraTools'
import { GoStudioButton } from './GoStudioModal'

type View = 'profile' | 'escape' | 'struct' | 'tools'
type EscapeScope = 'project' | 'package' | 'file'
const FIELD_ALIGNMENT_MODULE = 'golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest'

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Go-only optimization hub. The stripe entry is mounted only for projects with a Go module. */
export function GoStudioGoPanel({ session }: { session: GoIDESession }) {
  const modules = goModules(session.project)
  const [view, setView] = useState<View>('profile')
  const [scope, setScope] = useState<EscapeScope>('project')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const documents = useGoIDEStore((state) => state.documents)
  const activeDocumentId = useGoIDEStore((state) => state.activeDocumentBySession[session.id])
  const activeDocument = documents.find((item) => item.document.id === activeDocumentId && item.document.sessionId === session.id) ?? null
  const toolchain = useGoIDEStore((state) => state.toolchains[session.id])
  const trusted = session.project.authorization === 'tooling-permitted'
  const module = modules[0]

  const runEscapeAnalysis = async () => {
    if (!module) return
    const relative = activeDocument?.document.relativePath ?? ''
    const directory = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
    const target = scope === 'file' && relative.endsWith('.go') ? relative.split('/').pop()! : scope === 'package' && directory ? `./${directory}` : './...'
    setMessage(null)
    await useGoIDEStore.getState().startRun('build', { workingDirectory: module.path, target, goArguments: ['-gcflags=all=-m=2'] })
    useGoIDELspStore.getState().showToolWindow('run')
  }

  const runStructAnalysis = async (fix: boolean) => {
    if (!module) return
    setBusy(true); setMessage(null)
    try {
      let info = await detectGoIDEGoTool(session.id, 'fieldalignment')
      if (!info.available) {
        const approved = await confirm({ title: 'Install fieldalignment?', message: `go install ${FIELD_ALIGNMENT_MODULE}\n\nThe tool is installed in adOmnia's local tools folder and runs only when requested.`, confirmLabel: 'Install' })
        if (!approved) return
        await installGoIDEGoModule(session.id, FIELD_ALIGNMENT_MODULE)
        setMessage('Installation is running. Reopen Struct optimization when it finishes.')
        useGoIDELspStore.getState().showToolWindow('run')
        return
      }
      const args = fix ? ['-fix', './...'] : ['./...']
      const execution = await runGoIDEGoTool(session.id, 'fieldalignment', args, module.path)
      useGoIDEStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [session.id]: execution.id } }))
      useGoIDELspStore.getState().showToolWindow('run')
    } catch (error) { setMessage(errorText(error)) } finally { setBusy(false) }
  }

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center border-b border-border-1 px-2"><span className="px-2 text-[12px] font-semibold text-text-1">Go</span><span className="text-[11px] text-text-4">Optimization and Go tooling · {modules.length} module{modules.length === 1 ? '' : 's'}</span></div>
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Go optimization tools" className="w-52 shrink-0 border-r border-border-1 p-1.5">
        {([
          ['profile', 'Profiling with pprof', Gauge], ['escape', 'Escape analysis', Play], ['struct', 'Struct optimization', Boxes], ['tools', 'Go tools', Wrench],
        ] as const).map(([id, label, Icon]) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)} className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] ${view === id ? 'bg-accent/15 text-accent' : 'text-text-2 hover:bg-surface-2/70'}`}><Icon size={13} />{label}</button>)}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        {view === 'profile' && <GoStudioProfilePanel session={session} />}
        {view === 'escape' && <div className="mx-auto max-w-3xl p-6">
          <h3 className="text-[14px] font-semibold text-text-1">Compiler escape and inlining analysis</h3>
          <p className="mt-1 text-[12px] text-text-4">Runs the project compiler with <code className="gs-mono">-gcflags=all=-m=2</code>. The Run console reports heap escapes, moved values, parameters that leak and inlining decisions.</p>
          <div className="mt-5 grid gap-2">{(['project', 'package', 'file'] as const).map((item) => <label key={item} className="flex items-center gap-2 text-[12px] text-text-2"><input type="radio" checked={scope === item} onChange={() => setScope(item)} />{item === 'project' ? 'Whole project' : item === 'package' ? 'Current package' : `Current file${activeDocument?.document.relativePath ? ` · ${activeDocument.document.relativePath}` : ''}`}</label>)}</div>
          <GoStudioButton className="mt-5" variant="primary" icon={Play} disabled={!trusted || !module || (scope === 'file' && !activeDocument?.document.relativePath.endsWith('.go'))} title={trusted ? 'Run compiler analysis' : 'Trust project tools first'} onClick={() => void runEscapeAnalysis()}>Run escape analysis</GoStudioButton>
        </div>}
        {view === 'struct' && <div className="mx-auto grid max-w-4xl gap-4 p-6 md:grid-cols-2">
          <section className="rounded-xl border border-border-1 bg-surface-1 p-4"><h3 className="text-[13px] font-semibold text-text-1">Analyze layout</h3><p className="mt-1 text-[11.5px] text-text-4">Finds structs that waste memory because fields are ordered with avoidable padding. Analysis is read-only.</p><GoStudioButton className="mt-4" icon={Play} disabled={!trusted || busy || !module} onClick={() => void runStructAnalysis(false)}>Analyze project</GoStudioButton></section>
          <section className="rounded-xl border border-border-1 bg-surface-1 p-4"><h3 className="text-[13px] font-semibold text-text-1">Apply field ordering</h3><p className="mt-1 text-[11.5px] text-text-4">Runs fieldalignment with <code className="gs-mono">-fix</code>. Review the resulting Git changes before committing.</p><GoStudioButton className="mt-4" variant="danger-ghost" disabled={!trusted || busy || !module} onClick={() => void runStructAnalysis(true)}>Analyze and fix…</GoStudioButton></section>
          {message && <p role="status" className="md:col-span-2 text-[11.5px] text-text-3">{message}</p>}
        </div>}
        {view === 'tools' && <div className="p-4"><GoStudioExtraTools sessionId={session.id} goAvailable={toolchain?.available === true} trusted={trusted} /></div>}
      </div>
    </div>
  </div>
}
