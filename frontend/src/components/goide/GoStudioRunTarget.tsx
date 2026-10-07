import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { GoIDERunConfigurationKind, listGoIDERemoteTargets, type GoIDERemoteTarget, type GoIDERunConfiguration } from '@/lib/goide-api'

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

interface GoStudioRunTargetProps {
  draft: GoIDERunConfiguration
  patch: (change: Partial<GoIDERunConfiguration>) => void
}

/**
 * "Run on": questa macchina, una distro WSL, un host di ~/.ssh/config o un container in esecuzione.
 * Il codice non viene copiato: per SSH e container si indica dove si trova la stessa cartella dall'altra parte.
 */
export function GoStudioRunTarget({ draft, patch }: GoStudioRunTargetProps) {
  const [targets, setTargets] = useState<GoIDERemoteTarget[]>([])
  const [loading, setLoading] = useState(false)
  const remote = (draft.remote ?? undefined) as GoIDERemoteTarget | undefined

  const refresh = () => {
    setLoading(true)
    listGoIDERemoteTargets().then(setTargets, () => setTargets([])).finally(() => setLoading(false))
  }
  useEffect(refresh, [])

  // Una configurazione salvata può citare un container fermo o un host non più in ~/.ssh/config: resta selezionabile.
  const options = remote && !targets.some((item) => keyOf(item) === keyOf(remote)) ? [remote, ...targets] : targets
  const setRemote = (next: GoIDERemoteTarget | undefined) => patch({ remote: next ?? null })
  const needsDirectory = remote && remote.kind !== 'wsl'

  return (
    <>
      <label className="gs-field-label">
        Run on
        <span className="flex items-center gap-1.5">
          <select
            value={remote ? keyOf(remote) : ''}
            onChange={(event) => {
              const picked = options.find((item) => keyOf(item) === event.target.value)
              setRemote(picked ? { kind: picked.kind, name: picked.name, directory: remote?.kind === picked.kind ? remote.directory : '' } : undefined)
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
      {remote && (
        <p className="gs-hint col-span-2 -mt-2">
          {remote.kind === 'wsl' && 'Runs with the Go toolchain installed in the distro. Paths are translated automatically.'}
          {remote.kind === 'ssh' && 'Runs over ssh with your keys or agent (no password prompts). The folder must hold the same checkout. Environment values travel in the remote command.'}
          {remote.kind === 'container' && 'Runs with docker exec. The folder is where the project is mounted in the container. Environment values are passed with -e, never on the command line.'}
          {' '}Stop ends the remote process; console input is not forwarded.
        </p>
      )}
    </>
  )
}
