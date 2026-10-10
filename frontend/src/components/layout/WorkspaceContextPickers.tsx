import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { EnvBar } from '@/components/environment/EnvBar'
import { HostBar } from '@/components/hosts/HostBar'

// Environment and hosts switchers for the API Workspace header.
export function WorkspaceContextPickers() {
  const env = useEnvironmentsStore()
  const hosts = useHostsStore()
  return <div className="api-header-context flex min-w-0 items-center gap-2">
    <div className="w-[270px] min-w-0">
      <EnvBar
        compact
        environments={env.environments}
        activeEnvId={env.activeEnvId}
        onSetActive={env.setActiveEnv}
        onAdd={(name) => env.addEnvironment(name)}
        onDelete={env.deleteEnvironment}
        onRename={env.renameEnvironment}
        onUpdateVars={env.updateVariables}
        onSetPrivate={env.setEnvironmentPrivate}
      />
    </div>
    <div className="w-[200px] min-w-0">
      <HostBar
        compact
        profiles={hosts.profiles}
        activeProfileId={hosts.activeProfileId}
        onSetActive={hosts.setActiveProfile}
        onAdd={(name) => hosts.addProfile(name)}
        onDelete={hosts.deleteProfile}
        onRename={hosts.renameProfile}
        onUpdateEntries={hosts.updateEntries}
      />
    </div>
  </div>
}
