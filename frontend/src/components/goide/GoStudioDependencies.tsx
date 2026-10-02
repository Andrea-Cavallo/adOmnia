import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowUpCircle, History, Loader2, Package, PackagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { listGoIDEDependencies, listGoIDEModuleVersions, startGoIDEDependencyAction, type GoIDEDependencyState, type GoIDESession } from '@/lib/goide-api'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDEStore } from '@/stores/goide'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'
import { GoStudioGoModSettings, type GoModEdit } from './GoStudioGoModSettings'
import { GoStudioWorkspaceModules } from './GoStudioWorkspaceModules'

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
  const [tab, setTab] = useState<'requirements' | 'gomod' | 'workspace'>('requirements')
  // Versioni pubblicate per dipendenza, caricate solo su richiesta (passano dal GOPROXY).
  const [versions, setVersions] = useState<Record<string, string[] | 'loading'>>({})
  const executions = useGoIDEStore((store) => store.executions)
  const updateLayout = useGoIDEStore((store) => store.updateLayout)
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
    setVersions({})
    if (directory) void load(directory)
  }, [open, session.id])

  useEffect(() => {
    if (open && lastDependencyRun && lastDependencyRun.status !== 'running') void load()
  }, [lastDependencyRun?.status])

  if (!open) return null

  const execute = async (action: 'add' | 'update' | 'downgrade' | 'remove', path: string, selectedVersion: string) => {
    const suffix = action === 'remove' ? '@none' : `@${selectedVersion || 'latest'}`
    const verb = { add: 'Add', update: 'Update', downgrade: 'Downgrade', remove: 'Remove' }[action]
    const note = action === 'downgrade' ? ' Dependencies that need a newer version may be downgraded or removed too.' : ''
    const approved = await confirm({ title: `${verb} dependency?`, message: `Command: go get ${path}${suffix}\nWorking directory: ${moduleDirectory}\n\nThis may contact the configured Go proxy and will update go.mod/go.sum.${note}`, confirmLabel: `Run go get`, variant: action === 'remove' || action === 'downgrade' ? 'danger' : 'default' })
    if (!approved) return
    try {
      // Un downgrade è un go get path@versione: il backend non distingue la direzione.
      await startGoIDEDependencyAction({ sessionId: session.id, moduleDirectory, action: action === 'downgrade' ? 'update' : action, modulePath: path, version: selectedVersion, confirmed: true })
      updateLayout({ bottomOpen: true })
      if (action === 'add') { setModulePath(''); setVersion('latest') }
    } catch (reason) { setError(String(reason)) }
  }

  const editGoMod = async (edit: GoModEdit) => {
    const preview = edit.request.action === 'tidydiff'
    const approved = await confirm({ title: edit.title, message: `Command: ${edit.command}\nWorking directory: ${moduleDirectory}\n\n${preview ? 'Nothing is changed: the diff appears in the Run panel.' : 'go.mod is updated; nothing is downloaded.'}`, confirmLabel: preview ? 'Show diff' : 'Run go mod edit', variant: edit.danger ? 'danger' : 'default' })
    if (!approved) return
    try {
      await startGoIDEDependencyAction({ sessionId: session.id, moduleDirectory, ...edit.request, confirmed: true })
      updateLayout({ bottomOpen: true })
    } catch (reason) { setError(String(reason)) }
  }

  const loadVersions = async (path: string) => {
    setVersions((current) => ({ ...current, [path]: 'loading' }))
    try {
      const list = await listGoIDEModuleVersions(session.id, moduleDirectory, path)
      setVersions((current) => ({ ...current, [path]: list }))
    } catch (reason) {
      setVersions((current) => { const next = { ...current }; delete next[path]; return next })
      setError(String(reason))
    }
  }

  const running = lastDependencyRun?.status === 'running'
  const summary = state && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="gs-badge gs-mono">{state.modulePath}</span>
      <span className={`gs-badge ${state.goSumPresent ? 'text-success' : ''}`}>go.sum {state.goSumPresent ? 'present' : 'missing'}</span>
      <span className="gs-badge">{state.dependencies.length} requirement{state.dependencies.length === 1 ? '' : 's'}</span>
    </div>
  )

  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      tall
      divided
      icon={Package}
      title="Go dependencies"
      subtitle="Manage requirements and go.mod directives. Every change is confirmed first."
      footerStart={running ? <><Loader2 size={13} className="animate-spin" /> go get is running…</> : 'Changes update go.mod and go.sum.'}
      footer={<GoStudioButton variant="ghost" onClick={onClose}>Close</GoStudioButton>}
    >
      {error && <GoStudioAlert icon={AlertCircle}>{error}</GoStudioAlert>}
      {session.project.modules.length === 0 ? (
        <div className="gs-surface gs-list-empty">This project has no Go module. Open or create a folder with a go.mod to manage dependencies.</div>
      ) : <>
        <div className="flex items-end gap-2">
          <GoStudioField label="Module" className="flex-1">
            <select value={moduleDirectory} onChange={(event) => { setModuleDirectory(event.target.value); void load(event.target.value) }} className="gs-input gs-mono">
              {session.project.modules.map((module) => <option key={module.path} value={module.path}>{module.modulePath || module.path}</option>)}
            </select>
          </GoStudioField>
          <GoStudioButton variant="secondary" className="gs-btn-icon" disabled={loading} onClick={() => void load()} aria-label="Reload dependencies" title="Reload">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </GoStudioButton>
        </div>
        {summary}
        <div role="tablist" aria-label="Dependencies view" className="gs-segmented self-start">
          <button type="button" role="tab" aria-selected={tab === 'requirements'} onClick={() => setTab('requirements')} className="gs-segment">Requirements</button>
          <button type="button" role="tab" aria-selected={tab === 'gomod'} onClick={() => setTab('gomod')} className="gs-segment">go.mod</button>
          {session.project.modules.length > 1 && <button type="button" role="tab" aria-selected={tab === 'workspace'} onClick={() => setTab('workspace')} className="gs-segment">Workspace modules</button>}
        </div>
        {tab === 'workspace' && <GoStudioWorkspaceModules sessionId={session.id} onSelect={(directory) => { const target = session.project.modules.find((module) => module.path.replace(/\\/g, '/').endsWith(`/${directory}`) || (directory === '' && module.path === session.project.realPath)); if (target) { setModuleDirectory(target.path); void load(target.path) } setTab('requirements') }} />}
        {tab === 'gomod' && state && <GoStudioGoModSettings state={state} running={running} onEdit={(edit) => void editGoMod(edit)} />}
        {tab === 'requirements' && <>
        <div className="gs-list min-h-0 flex-1">
          {state?.dependencies.length === 0 && <div className="gs-list-empty">No requirements in this go.mod yet.</div>}
          {!state && loading && <div className="gs-list-empty">Reading go.mod…</div>}
          {state?.dependencies.map((dependency) => (
            <div key={dependency.path} className="gs-list-row">
              <div className="min-w-0 flex-1">
                <div className="gs-mono truncate text-text-1">{dependency.path}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-4">
                  <span className="gs-mono text-[11px]">{dependency.version}</span>
                  {dependency.indirect && <span className="gs-badge h-[18px] text-[10.5px]">indirect</span>}
                </div>
              </div>
              <div className="gs-row-actions">
                <DependencyVersionPicker available={versions[dependency.path]} current={dependency.version} running={running} onLoad={() => void loadVersions(dependency.path)} onPick={(chosen, downgrade) => void execute(downgrade ? 'downgrade' : 'update', dependency.path, chosen)} />
                <GoStudioButton small variant="ghost" icon={ArrowUpCircle} disabled={running} onClick={() => void execute('update', dependency.path, 'latest')}>Update</GoStudioButton>
                <GoStudioButton small variant="danger-ghost" className="gs-btn-icon" disabled={running} onClick={() => void execute('remove', dependency.path, '')} aria-label={`Remove ${dependency.path}`} title="Remove"><Trash2 size={13} /></GoStudioButton>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <GoStudioField label="Add module" className="flex-1">
            <input value={modulePath} onChange={(event) => setModulePath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && modulePath && !running) void execute('add', modulePath, version) }} placeholder="github.com/example/pkg" className="gs-input gs-mono" />
          </GoStudioField>
          <GoStudioField label="Version" className="w-32">
            <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="latest" className="gs-input gs-mono" />
          </GoStudioField>
          <GoStudioButton variant="primary" icon={PackagePlus} disabled={!modulePath || running} onClick={() => void execute('add', modulePath, version)}>Add</GoStudioButton>
        </div>
        </>}
      </>}
    </GoStudioModal>
  )
}

interface DependencyVersionPickerProps {
  available: string[] | 'loading' | undefined
  current: string
  running: boolean
  onLoad: () => void
  onPick: (version: string, downgrade: boolean) => void
}

/** Versioni pubblicate di una dipendenza (dalla più recente): una più vecchia di quella attuale è un downgrade. */
function DependencyVersionPicker({ available, current, running, onLoad, onPick }: DependencyVersionPickerProps) {
  if (available === 'loading') return <Loader2 size={13} className="animate-spin text-text-4" aria-label="Loading versions" />
  if (!available) return <GoStudioButton small variant="ghost" icon={History} disabled={running} onClick={onLoad} title="List published versions to upgrade or downgrade">Versions</GoStudioButton>
  const currentIndex = available.indexOf(current)
  return (
    <select value="" disabled={running} aria-label="Change version" onChange={(event) => { const chosen = event.target.value; if (chosen) onPick(chosen, currentIndex >= 0 && available.indexOf(chosen) > currentIndex) }} className="gs-input gs-mono h-7 w-36 py-0 text-[11.5px]">
      <option value="">{available.length} versions…</option>
      {available.map((item, index) => <option key={item} value={item} disabled={item === current}>{item}{item === current ? ' (current)' : currentIndex >= 0 && index > currentIndex ? ' ↓' : ''}</option>)}
    </select>
  )
}
