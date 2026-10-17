import { useState, type ReactNode } from 'react'
import { AlertTriangle, Download, Globe2, Loader2, Play, RefreshCw, ShieldAlert, Terminal } from 'lucide-react'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useLivePreviewStore, type SessionPreview } from '@/stores/livePreview'
import { useIdeWebServersStore } from '@/stores/ideWebServers'
import { phaseOf, previewChoices, type PreviewChoice } from '@/lib/code-studio/livePreview'
import type { GoIDESession } from '@/lib/code-studio-api'
import type { LivePreview, LivePreviewRequest, LivePreviewTarget } from '@/lib/livepreview-api'

interface SetupProps {
  session: GoIDESession
  view: SessionPreview
  preview: LivePreview | null
}

const PANEL = 'flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto px-6 py-8 text-center'
const PRIMARY = 'gs-btn gs-btn-sm gs-btn-primary'
const SECONDARY = 'gs-btn gs-btn-sm gs-btn-secondary'

function Message({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className={PANEL}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-surface-3 text-text-3" aria-hidden="true">{icon}</div>
      <h3 className="text-[13px] font-semibold text-text-1">{title}</h3>
      <div className="flex max-w-md flex-col items-center gap-2 text-[12px] leading-5 text-text-3">{children}</div>
    </div>
  )
}

/** Il target di una richiesta di dev server, per sapere dove installare le dipendenze. */
function targetFor(view: SessionPreview, request: LivePreviewRequest | null): LivePreviewTarget | undefined {
  const targets = view.report?.targets ?? []
  return targets.find((target) => target.relative === (request?.dir ?? '.')) ?? targets.find((target) => target.devScript) ?? targets[0]
}

function openRunConsole() {
  useCodeStudioLspStore.getState().showToolWindow('run')
}

/** Tutto ciò che non è la pagina: fiducia, scelta, avvio in corso, errori spiegati e primo "Go Live". */
export function CodeStudioPreviewSetup({ session, view, preview }: SetupProps) {
  const goLive = useLivePreviewStore((state) => state.goLive)
  const sessionId = session.id
  const trusted = session.project.authorization === 'tooling-permitted'
  const phase = phaseOf(preview)
  const [confirmInstall, setConfirmInstall] = useState<'dependencies' | 'tools' | null>(null)

  if (!trusted) {
    return (
      <Message icon={<ShieldAlert size={20} />} title="Trust this project to preview it">
        <p>A live preview runs the project&apos;s own code: its dev server script, or a local server for its files. adOmnia never starts either of them until you trust the folder.</p>
        <button type="button" className={PRIMARY} onClick={() => void useCodeStudioStore.getState().setToolAuthorization(true).then(() => goLive(sessionId, view.lastRequest ?? undefined))}>Trust project tools and Go Live</button>
      </Message>
    )
  }

  if (view.install) {
    return (
      <Message icon={<Loader2 size={20} className="animate-spin" />} title="Installing dependencies…">
        <p>The command is running in the Run console. The preview starts by itself when it finishes.</p>
        <button type="button" className={SECONDARY} onClick={openRunConsole}><Terminal size={12} /> Show Run console</button>
      </Message>
    )
  }

  if (view.chooserOpen) return <Chooser sessionId={sessionId} view={view} onPick={(choice) => void goLive(sessionId, choice)} />

  if (phase === 'starting' || view.starting) {
    return (
      <Message icon={<Loader2 size={20} className="animate-spin" />} title={preview?.mode === 'devserver' ? 'Starting the dev server…' : 'Starting the preview…'}>
        {preview?.command && <code className="rounded bg-surface-3 px-2 py-1 font-mono text-[11px] text-text-2">{preview.command}</code>}
        <p>Waiting for the server to print its address and answer. The first start can take a while.</p>
        <button type="button" className={SECONDARY} onClick={openRunConsole}><Terminal size={12} /> Show Run console</button>
      </Message>
    )
  }

  if (phase === 'failed' || (preview && phaseOf(preview) === 'idle' && preview.error)) {
    return <Failure session={session} view={view} preview={preview!} confirm={confirmInstall} setConfirm={setConfirmInstall} />
  }

  if (preview && phase === 'idle') {
    return (
      <Message icon={<Globe2 size={20} />} title="Preview stopped">
        <p>{preview.label ? `${preview.label} is not running.` : 'The preview is not running.'}</p>
        <button type="button" className={PRIMARY} onClick={() => void goLive(sessionId, view.lastRequest ?? undefined)}><Play size={12} /> Go Live</button>
      </Message>
    )
  }

  return <Idle session={session} view={view} confirm={confirmInstall} setConfirm={setConfirmInstall} />
}

function Chooser({ sessionId, view, onPick }: { sessionId: string; view: SessionPreview; onPick: (choice: PreviewChoice) => void }) {
  const choices = previewChoices(view.report)
  const dismiss = useLivePreviewStore((state) => state.dismissChooser)
  return (
    <div className={PANEL}>
      <h3 className="text-[13px] font-semibold text-text-1">What do you want to preview?</h3>
      {choices.length === 0 ? (
        <p className="max-w-sm text-[12px] leading-5 text-text-3">{view.error ?? 'Nothing to preview here: add an index.html, or a package.json with a dev or start script.'}</p>
      ) : (
        <ul className="flex w-full max-w-md flex-col gap-1.5" aria-label="Previewable targets">
          {choices.map((choice) => (
            <li key={choice.key}>
              <button type="button" onClick={() => onPick(choice)} className="group flex w-full items-center gap-3 rounded-lg border border-border-1 bg-surface-2 px-3 py-2 text-left transition-colors hover:border-accent hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <Play size={13} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-text-1">{choice.label}</span>
                  <span className="block truncate text-[11px] text-text-4">{choice.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={SECONDARY} onClick={() => dismiss(sessionId)}>Cancel</button>
    </div>
  )
}

function InstallConfirm({ command, onConfirm, onCancel, title }: { command: string; onConfirm: () => void; onCancel: () => void; title: string }) {
  return (
    <div role="alertdialog" aria-label={title} className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-border-2 bg-surface-2 p-3 text-left">
      <p className="text-[12px] font-medium text-text-1">{title}</p>
      <code className="block overflow-x-auto rounded bg-surface-3 px-2 py-1.5 font-mono text-[11px] text-text-2">{command}</code>
      <p className="text-[11px] leading-4 text-text-4">This downloads packages from the registry and runs install scripts of the project&apos;s dependencies. It is the only network access this feature makes, and only because you confirm it.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
        <button type="button" className={PRIMARY} onClick={onConfirm}><Download size={12} /> Install</button>
      </div>
    </div>
  )
}

function Failure({ session, view, preview, confirm, setConfirm }: { session: GoIDESession; view: SessionPreview; preview: LivePreview; confirm: 'dependencies' | 'tools' | null; setConfirm: (value: 'dependencies' | 'tools' | null) => void }) {
  const { goLive, installDependencies, load } = useLivePreviewStore.getState()
  const target = targetFor(view, view.lastRequest)
  const missing = preview.failureKind === 'missing-dependencies'
  const command = target?.installCommand?.join(' ') ?? 'npm install'
  const retry = () => void goLive(session.id, view.lastRequest ?? undefined)
  return (
    <Message icon={<AlertTriangle size={20} className="text-warning" />} title={titleFor(preview.failureKind)}>
      <p role="alert">{preview.error}</p>
      {!!preview.hints?.length && (
        <ul className="list-disc space-y-1 pl-4 text-left">{preview.hints.map((hint) => <li key={hint}>{hint}</li>)}</ul>
      )}
      {missing && confirm === 'dependencies' && (
        <InstallConfirm title={`Install dependencies in ${target?.relative === '.' ? 'the project' : target?.relative}?`} command={command}
          onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void installDependencies(session.id, target?.relative ?? '.', view.lastRequest) }} />
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {missing && confirm !== 'dependencies' && <button type="button" className={PRIMARY} onClick={() => setConfirm('dependencies')}><Download size={12} /> Install dependencies…</button>}
        {preview.failureKind === 'runtime' && <button type="button" className={PRIMARY} onClick={() => void load(session.id).then(retry)}><RefreshCw size={12} /> Check again</button>}
        {!missing && preview.failureKind !== 'runtime' && <button type="button" className={PRIMARY} onClick={retry}><RefreshCw size={12} /> Try again</button>}
        {preview.runId && <button type="button" className={SECONDARY} onClick={openRunConsole}><Terminal size={12} /> Run console</button>}
      </div>
    </Message>
  )
}

function titleFor(kind: string | undefined): string {
  switch (kind) {
    case 'runtime': return 'Node.js is not available'
    case 'missing-dependencies': return 'Dependencies are not installed'
    case 'port-in-use': return 'The port is already in use'
    case 'no-script': return 'No script to run'
    case 'timeout': return 'The dev server did not start in time'
    default: return 'The preview could not start'
  }
}

function Idle({ session, view, confirm, setConfirm }: { session: GoIDESession; view: SessionPreview; confirm: 'dependencies' | 'tools' | null; setConfirm: (value: 'dependencies' | 'tools' | null) => void }) {
  const goLive = useLivePreviewStore((state) => state.goLive)
  const installTools = useIdeWebServersStore((state) => state.install)
  const report = view.report
  const choices = previewChoices(report)
  const runtime = report?.runtime
  const missingServers = (report?.servers ?? []).filter((server) => !server.available)
  const hasWebCode = (report?.targets.length ?? 0) > 0
  return (
    <div className={PANEL}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/12 text-accent" aria-hidden="true"><Globe2 size={22} /></div>
      <h3 className="text-[14px] font-semibold text-text-1">Live Preview</h3>
      {view.error && <p role="alert" className="max-w-md text-[12px] leading-5 text-danger">{view.error}</p>}
      {!hasWebCode && !view.loading && <p className="max-w-sm text-[12px] leading-5 text-text-3">This folder has no index.html and no package.json. Open a web project, or add an <code>index.html</code>, then press Go Live.</p>}
      {hasWebCode && (
        <>
          <ul className="flex max-w-md flex-col gap-0.5 text-[11.5px] text-text-3" aria-label="Detected project">
            {report?.targets.slice(0, 4).map((target) => (
              <li key={target.relative}><span className="font-medium text-text-2">{target.relative === '.' ? target.name || 'project' : target.relative}</span>{' · '}{describeTarget(target)}</li>
            ))}
          </ul>
          {runtime && <p className="text-[11px] text-text-4">{runtime.nodeAvailable ? `Node.js ${runtime.nodeVersion}` : 'Node.js not found'}{runtime.packageManagerAvailable ? ` · ${report?.targets.find((target) => target.devScript)?.packageManager ?? 'npm'} ${runtime.packageManagerVersion}` : ''}</p>}
          {runtime?.problem && choices.some((choice) => choice.request.mode === 'devserver') && (
            <div className="max-w-md rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-left text-[11.5px] leading-5 text-text-2" role="status">
              <p className="font-medium">{runtime.problem}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-3">{runtime.remedies?.map((remedy) => <li key={remedy}>{remedy}</li>)}</ul>
            </div>
          )}
          <button type="button" className={`${PRIMARY} px-5`} disabled={view.loading || view.starting} onClick={() => void goLive(session.id)}><Play size={12} /> Go Live</button>
        </>
      )}
      {missingServers.length > 0 && hasWebCode && (
        <div className="max-w-md text-[11px] leading-4 text-text-4">
          {confirm === 'tools' ? (
            <InstallConfirm title="Install the web language servers?" command="npm install --prefix <adOmnia tools folder> typescript-language-server typescript vscode-langservers-extracted"
              onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void installTools(session.id) }} />
          ) : (
            <p>Editor intelligence for {missingServers.map((server) => server.language).join(', ')} uses the built-in Monaco features until the language servers are installed. <button type="button" className="text-accent underline decoration-dotted underline-offset-2" onClick={() => setConfirm('tools')}>Install them…</button></p>
          )}
        </div>
      )}
    </div>
  )
}

function describeTarget(target: LivePreviewTarget): string {
  if (target.kind === 'static') return 'static site'
  const parts = [target.framework || 'Node.js', target.tool, target.packageManager].filter(Boolean)
  return `${parts.join(' · ')}${target.devScript ? ` · "${target.devScript}" script` : ' · no dev script'}`
}
