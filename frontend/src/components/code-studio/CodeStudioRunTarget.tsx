import { Events } from '@wailsio/runtime'
import { confirm } from '@/lib/confirmDialog'
import { StartDevContainer, StopRun } from '../../../bindings/adomnia/goide'
import { CodeStudioButton } from './CodeStudioModal'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { GoIDERunConfigurationKind, listGoIDERemoteTargets, type GoIDERemoteTarget, type GoIDERunConfiguration } from '@/lib/code-studio-api'
import { InspectContainer } from '../../../bindings/adomnia/goide'
import type { ContainerInfo } from '../../../bindings/adomnia/internal/ide/remote/models'

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
  const [targets, setTargets] = useState<GoIDERemoteTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [devBusy,setDevBusy]=useState(false)
  const [devRun,setDevRun]=useState<string|null>(null)
  const [devResult,setDevResult]=useState<{runId:string;target:GoIDERemoteTarget;error?:string}|null>(null)
  useEffect(()=>Events.On('code-studio:event',event=>{
    const detail=event.data as {type:string;sessionId:string;payload:{runId:string;target:GoIDERemoteTarget;error?:string}}
    if(detail.type==='devcontainer.ready' && detail.sessionId===draft.sessionId) setDevResult(detail.payload)
  }),[draft.sessionId])
  useEffect(()=>{
    if(!devRun || devResult?.runId!==devRun) return
    setDevBusy(false);setDevRun(null);setDevResult(null)
    if(devResult.error) setContainerError(devResult.error)
    else patch({remote:devResult.target})
  },[devRun,devResult])
  const startDev=async()=> {
    if(!await confirm({title:'Start dev container?',message:'The project configuration can build images, download features, mount files and execute lifecycle scripts. Docker and a locally installed Dev Container CLI are required.',confirmLabel:'Start dev container'})) return
    setDevBusy(true);setDevRun(null);setDevResult(null);setContainerError('')
    try { const run=await StartDevContainer(draft.sessionId);setDevRun(run.id);useCodeStudioStore.getState().updateLayout({bottomOpen:true}) }
    catch(error){setContainerError(String(error));setDevBusy(false)}
  }

  const [container,setContainer] = useState<ContainerInfo | null>(null)
  const [containerError,setContainerError] = useState('')
  const remote = (draft.remote ?? undefined) as GoIDERemoteTarget | undefined

  const refresh = () => {
    setLoading(true)
    setContainerError('')
    listGoIDERemoteTargets().then(setTargets, () => { setContainerError('Run targets could not be loaded. Use Refresh to try again.') }).finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  // Una configurazione salvata può citare un container fermo o un host non più in ~/.ssh/config: resta selezionabile.
  const options = remote && !targets.some((item) => keyOf(item) === keyOf(remote)) ? [remote, ...targets] : targets
  const setRemote = (next: GoIDERemoteTarget | undefined) => patch({ remote: next ?? null })
  const needsDirectory = remote && remote.kind !== 'wsl'
  useEffect(()=>{
    let active=true
    setContainer(null);setContainerError('')
    if(remote?.kind==='container')void InspectContainer(draft.sessionId,remote.name).then(info=>{
      if(!active)return
      setContainer(info)
      if(!remote.directory && info.projectDirectory)patch({remote:{...remote,directory:info.projectDirectory}})
    },error=>{if(active)setContainerError(String(error))})
    return ()=>{active=false}
  },[draft.sessionId,remote?.kind,remote?.name])

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
        {container.ports.map((port,index)=><p key={index} className="gs-mono">{port.container} → {port.host || '0.0.0.0'}:{port.port}</p>)}
      </div>}
      {containerError && <p className="col-span-2 text-[11px] text-warning">{containerError}</p>}
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
