import { NothingStudioHeader } from '@/components/ui/NothingStudioHeader'
import './codeStudioGoPanel.css'
import { useState } from 'react'
import { Boxes, Gauge, Play, Wrench } from 'lucide-react'
import type { GoIDESession } from '@/lib/code-studio-api'
import { confirm } from '@/lib/confirmDialog'
import { detectGoIDEGoTool, installGoIDEGoModule, runGoIDEGoTool } from '@/lib/code-studio-api'
import { activeGoIDERelativePath, useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { goModules } from '@/lib/code-studio/goProject'
import { CodeStudioProfilePanel } from './CodeStudioProfilePanel'
import { CodeStudioExtraTools } from './CodeStudioExtraTools'
import { CodeStudioButton } from './CodeStudioModal'

type View = 'profile' | 'escape' | 'struct' | 'tools'
type EscapeScope = 'project' | 'package' | 'file'
const VIEWS = [
  { id: 'profile', title: 'Profiling', label: 'Profiling with pprof', description: 'Capture CPU and memory profiles. Find where your code spends time.', icon: Gauge },
  { id: 'escape', title: 'Escape analysis', label: 'Escape analysis', description: 'Inspect heap allocations and compiler inlining decisions.', icon: Play },
  { id: 'struct', title: 'Struct layout', label: 'Struct optimization', description: 'Find avoidable padding and inspect field alignment.', icon: Boxes },
  { id: 'tools', title: 'Go tools', label: 'Go tools', description: 'Inspect, install and run tools with the project SDK.', icon: Wrench },
] as const

const FIELD_ALIGNMENT_MODULE = 'golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest'

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Go-only optimization hub. The stripe entry is mounted only for projects with a Go module. */
export function CodeStudioGoPanel({ session }: { session: GoIDESession }) {
  const modules = goModules(session.project)
  const [view, setView] = useState<View>('profile')
  const [scope, setScope] = useState<EscapeScope>('project')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Solo il path del documento attivo: una stringa primitiva non ridisegna il
  // pannello a ogni battuta, come farebbe la sottoscrizione a state.documents.
  const activeRelativePath = useCodeStudioStore((state) => activeGoIDERelativePath(state, session.id))
  const toolchain = useCodeStudioStore((state) => state.toolchains[session.id])
  const trusted = session.project.authorization === 'tooling-permitted'
  const module = modules[0]
  const activeView = VIEWS.find(item => item.id === view)!
  const ActiveIcon = activeView.icon

  const runEscapeAnalysis = async () => {
    if (!module) return
    const relative = activeRelativePath
    const directory = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
    const target = scope === 'file' && relative.endsWith('.go') ? relative.split('/').pop()! : scope === 'package' && directory ? `./${directory}` : './...'
    setMessage(null)
    await useCodeStudioStore.getState().startRun('build', { workingDirectory: module.path, target, goArguments: ['-gcflags=all=-m=2'] })
    useCodeStudioLspStore.getState().showToolWindow('run')
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
        useCodeStudioLspStore.getState().showToolWindow('run')
        return
      }
      const args = fix ? ['-fix', './...'] : ['./...']
      const execution = await runGoIDEGoTool(session.id, 'fieldalignment', args, module.path)
      useCodeStudioStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [session.id]: execution.id } }))
      useCodeStudioLspStore.getState().showToolWindow('run')
    } catch (error) { setMessage(errorText(error)) } finally { setBusy(false) }
  }

  return <div className="nothing-studio go-tools-studio h-full">
    <NothingStudioHeader title="Go" section="Code Studio / Tooling" detail="Performance & optimization" count={`${modules.length} module${modules.length === 1 ? '' : 's'}`} />
    <div className="go-tools-layout">
      <nav aria-label="Go optimization tools" className="go-tools-nav">
        <p className="nothing-studio-label">Workbench / Go</p>
        {VIEWS.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
          <span className="go-tools-nav-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><Icon size={15} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span>
        </button>)}
        <div className="go-tools-nav-foot"><span className="nothing-studio-dot" />Project SDK</div>
      </nav>
      <div className="go-tools-content">
        <header className="go-tools-view-header">
          <div className="go-tools-view-glyph" aria-hidden="true"><ActiveIcon size={24} strokeWidth={1.25} /></div>
          <div><p className="nothing-studio-label">Go / {String(VIEWS.findIndex(item => item.id === view) + 1).padStart(2, '0')}</p><h2>{activeView.title}</h2><p className="go-tools-view-description">{activeView.description}</p></div>
        </header>
        <div className="go-tools-view-body">
        {view === 'profile' && <CodeStudioProfilePanel session={session} />}
        {view === 'escape' && <div className="go-tools-analysis">
          <h3 className="text-[14px] font-semibold text-text-1">Compiler escape and inlining analysis</h3>
          <p className="mt-1 text-[12px] text-text-4">Runs the project compiler with <code className="gs-mono">-gcflags=all=-m=2</code>. The Run console reports heap escapes, moved values, parameters that leak and inlining decisions.</p>
          <div className="go-tools-scopes">{(['project', 'package', 'file'] as const).map((item) => <label key={item} className="go-tools-scope"><input type="radio" name="go-escape-scope" checked={scope === item} onChange={() => setScope(item)} />{item === 'project' ? 'Whole project' : item === 'package' ? 'Current package' : `Current file${activeRelativePath ? ` · ${activeRelativePath}` : ''}`}</label>)}</div>
          <CodeStudioButton className="mt-5" variant="primary" icon={Play} disabled={!trusted || !module || (scope === 'file' && !activeRelativePath.endsWith('.go'))} title={trusted ? 'Run compiler analysis' : 'Trust project tools first'} onClick={() => void runEscapeAnalysis()}>Run escape analysis</CodeStudioButton>
        </div>}
        {view === 'struct' && <div className="go-tools-struct-grid">
          <section className="go-tools-struct-card"><h3 className="text-[13px] font-semibold text-text-1">Analyze layout</h3><p className="mt-1 text-[11.5px] text-text-4">Finds structs that waste memory because fields are ordered with avoidable padding. Analysis is read-only.</p><CodeStudioButton className="mt-4" icon={Play} disabled={!trusted || busy || !module} onClick={() => void runStructAnalysis(false)}>Analyze project</CodeStudioButton></section>
          <section className="go-tools-struct-card"><h3 className="text-[13px] font-semibold text-text-1">Apply field ordering</h3><p className="mt-1 text-[11.5px] text-text-4">Runs fieldalignment with <code className="gs-mono">-fix</code>. Review the resulting Git changes before committing.</p><CodeStudioButton className="mt-4" variant="danger-ghost" disabled={!trusted || busy || !module} onClick={() => void runStructAnalysis(true)}>Analyze and fix…</CodeStudioButton></section>
          {message && <p role="status" className="go-tools-struct-message text-[11.5px] text-text-3">{message}</p>}
        </div>}
        {view === 'tools' && <div className="go-tools-extra"><CodeStudioExtraTools sessionId={session.id} goAvailable={toolchain?.available === true} trusted={trusted} /></div>}
        </div>
      </div>
    </div>
  </div>
}
