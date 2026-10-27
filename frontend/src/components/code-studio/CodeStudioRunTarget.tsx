import { Events } from '@wailsio/runtime'
import { confirm } from '@/lib/confirmDialog'
import { StartDevContainer, StopRun } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import { CodeStudioButton } from './CodeStudioModal'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { GoIDERunConfigurationKind, listGoIDERemoteTargets, type GoIDERemoteTarget, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import { withContentKeys } from '@/lib/contentKeys'
import { InspectContainer } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { ContainerInfo } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/ide/remote/models'

/** Tipi che il backend sa eseguire altrove: quelli che lanciano un singolo comando. */
const REMOTE_KINDS = new Set<string>([
  GoIDERunConfigurationKind.RunKindPackage, GoIDERunConfigurationKind.RunKindBuild, GoIDERunConfigurationKind.RunKindFiles,
  GoIDERunConfigurationKind.RunKindTest, GoIDERunConfigurationKind.RunKindBinary, GoIDERunConfigurationKind.RunKindCommand,
  GoIDERunConfigurationKind.RunKindGoTool,
])

const KIND_LABEL: Record<GoIDERemoteTarget['kind'], string> = { wsl: 'WSL', ssh: 'SSH', container: 'Container' }

const keyOf = (target: Pick<GoIDERemoteTarget, 'kind' | 'name'>) => `${target.kind}:${target.name}`

export function supportsRemoteTarget(kind: string): boolean {
  return REMOTE_KINDS.has(kind)
}

interface CodeStudioRunTargetProps {
  draft: GoIDERunConfiguration
  patch: (change: Partial<GoIDERunConfiguration>) => void
}

/**
 * "Run on": questa macchina, una distro WSL, un host di ~/.ssh/config o un container in esecuzione.
 * Il codice non viene copiato: per SSH e container si indica dove si trova la stessa cartella dall'altra parte.
 */
export function CodeStudioRunTarget({ draft, patch }: CodeStudioRunTargetProps) {
  type DevReady = { runId: string; target: GoIDERemoteTarget; error?: string }
  const [targets, setTargets] = useState<GoIDERemoteTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [devBusy, setDevBusy] = useState(false)
  const [devRun, setDevRun] = useState<string | null>(null)
  const [containerError, setContainerError] = useState('')
  const [inspected, setInspected] = useState<{ key: string; info?: ContainerInfo; error?: string } | null>(null)
  const remote = (draft.remote ?? undefined) as GoIDERemoteTarget | undefined

  // Latest values for async callbacks (events, inspect results) without re-subscribing them.
  const patchRef = useRef(patch)
  const remoteRef = useRef(remote)
  useEffect(() => { patchRef.current = patch; remoteRef.current = remote })
  // The dev container can report "ready" before StartDevContainer resolves: keep that early result.
  const devRunRef = useRef<string | null>(null)
  const earlyReady = useRef<DevReady | null>(null)

  const finishDev = useCallback((ready: DevReady) => {
    devRunRef.current = null
    earlyReady.current = null
    setDevBusy(false)
    setDevRun(null)
    if (ready.error) setContainerError(ready.error)
    else patchRef.current({ remote: ready.target })
  }, [])

  useEffect(() => Events.On('code-studio:event', (event) => {
    const detail = event.data as { type: string; sessionId: string; payload: DevReady }
    if (detail.type !== 'devcontainer.ready' || detail.sessionId !== draft.sessionId) return
    if (devRunRef.current === detail.payload.runId) finishDev(detail.payload)
    else earlyReady.current = detail.payload
  }), [draft.sessionId, finishDev])

  const startDev = async () => {
    if (!await confirm({ title: 'Start dev container?', message: 'The project configuration can build images, download features, mount files and execute lifecycle scripts. Docker and a locally installed Dev Container CLI are required.', confirmLabel: 'Start dev container' })) return
    setDevBusy(true); setDevRun(null); setContainerError('')
    devRunRef.current = null; earlyReady.current = null
    try {
      const run = await StartDevContainer(draft.sessionId)
      devRunRef.current = run.id
      setDevRun(run.id)
      useCodeStudioStore.getState().updateLayout({ bottomOpen: true })
      const early = earlyReady.current as DevReady | null
      if (early?.runId === run.id) finishDev(early)
    } catch (error) { setContainerError(String(error)); setDevBusy(false) }
  }

  const loadTargets = useCallback(() => listGoIDERemoteTargets()
    .then(setTargets, () => { setContainerError('Run targets could not be loaded. Use Refresh to try again.') })
    .finally(() => setLoading(false)), [])
  const refresh = () => {
    setLoading(true)
    setContainerError('')
    void loadTargets()
  }
  useEffect(() => { void loadTargets() }, [loadTargets])

  // Una configurazione salvata può citare un container fermo o un host non più in ~/.ssh/config: resta selezionabile.
  const options = remote && !targets.some((item) => keyOf(item) === keyOf(remote)) ? [remote, ...targets] : targets
  const setRemote = (next: GoIDERemoteTarget | undefined) => patch({ remote: next ?? null })
  const needsDirectory = remote && remote.kind !== 'wsl'
  const containerName = remote?.kind === 'container' ? remote.name : null
  const inspectKey = containerName ? `${draft.sessionId}:${containerName}` : null
  const container = inspected && inspected.key === inspectKey ? inspected.info ?? null : null
  const inspectError = inspected && inspected.key === inspectKey ? inspected.error ?? '' : ''
  useEffect(() => {
    if (!containerName || !inspectKey) return
    let active = true
    void InspectContainer(draft.sessionId, containerName).then((info) => {
      if (!active) return
      setInspected({ key: inspectKey, info })
      const current = remoteRef.current
      if (current && !current.directory && info.projectDirectory) patchRef.current({ remote: { ...current, directory: info.projectDirectory } })
    }, (error: unknown) => { if (active) setInspected({ key: inspectKey, error: String(error) }) })
    return () => { active = false }
  }, [draft.sessionId, containerName, inspectKey])

  return (
    <>
      <div className="col-span-2 flex items-center gap-2">
        <CodeStudioButton disabled={devBusy} onClick={()=>void startDev()}>Start dev container</CodeStudioButton>
        {devBusy && <span className="gs-hint">Starting dev container…</span>}
        {devBusy && devRun && <CodeStudioButton onClick={()=>void StopRun(devRun).catch(error=>setContainerError(String(error)))}>Cancel startup</CodeStudioButton>}
      </div>
      <label className="gs-field-label">
        Run on
        <span className="flex items-center gap-1.5">
          <select
            value={remote ? keyOf(remote) : ''}
            onChange={(event) => {
              const picked = options.find((item) => keyOf(item) === event.target.value)
              setRemote(picked ? { ...picked, ...(remote && keyOf(remote)===keyOf(picked) ? remote : {}), directory: remote && keyOf(remote)===keyOf(picked) ? remote.directory : picked.directory } : undefined)
            }}
            className="gs-input min-w-0 flex-1"
          >
            <option value="">This machine</option>
            {(['wsl', 'ssh', 'container'] as const).map((kind) => {
              const group = options.filter((item) => item.kind === kind)
              return group.length > 0 && (
                <optgroup key={kind} label={KIND_LABEL[kind]}>
                  {group.map((item) => <option key={keyOf(item)} value={keyOf(item)}>{item.name}</option>)}
                </optgroup>
              )
            })}
          </select>
          <button type="button" onClick={refresh} title="Look again for WSL distros, SSH hosts and running containers" className="gs-btn gs-btn-ghost gs-btn-sm gs-btn-icon h-8 w-8">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </span>
      </label>
      {remote && (
        <label className="gs-field-label">
          {needsDirectory ? `Project folder on ${remote.name}` : 'Project folder in WSL'}
          <input
            value={remote.directory ?? ''}
            onChange={(event) => setRemote({ ...remote, directory: event.target.value })}
            placeholder={needsDirectory ? (remote.kind === 'container' ? '/workspace' : '/home/me/project') : 'Automatic (/mnt/c/…)'}
            className="gs-input gs-mono"
          />
        </label>
      )}
      {container && <div className="col-span-2 space-y-1 text-[11px] text-text-3">
        <p>{container.image} · {container.running?'running':'stopped'} · {container.projectDirectory || 'No bind mount contains this project'}</p>
        {withContentKeys(container.ports, (port) => `${port.container}-${port.host}-${port.port}`).map(({ key, item: port }) => <p key={key} className="gs-mono">{port.container} → {port.host || '0.0.0.0'}:{port.port}</p>)}
      </div>}
      {(containerError || inspectError) && <p className="col-span-2 text-[11px] text-warning">{containerError || inspectError}</p>}
      {remote?.devContainerConfig && <p className="gs-hint col-span-2">Dev Container CLI exec applies remoteUser, remoteEnv and userEnvProbe from the project configuration. Custom run environment overrides are passed to the CLI; values are omitted from the displayed command.</p>}
      {remote && (
        <p className="gs-hint col-span-2 -mt-2">
          {remote.kind === 'wsl' && 'Runs with the configured executable installed in the distro. Paths are translated automatically.'}
          {remote.kind === 'ssh' && 'Runs over ssh with your keys or agent (no password prompts). The folder must hold the same checkout. Environment values travel in the remote command.'}
          {remote.kind === 'container' && 'Runs with docker exec. The folder is where the project is mounted in the container. Environment values are passed with -e, never on the command line.'}
          {' '}Stop ends the remote process; console input is not forwarded.
        </p>
      )}
    </>
  )
}
