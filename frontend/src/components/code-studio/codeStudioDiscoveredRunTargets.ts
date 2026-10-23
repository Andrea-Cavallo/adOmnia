import { GoIDERunConfigurationKind, type GoIDERunConfiguration, type GoIDERunTarget, type GoIDESession } from '@/lib/code-studio-api'
import { moduleScopeFor } from './codeStudioQuickActions'

function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  let end = slashed.length
  while (end > 0 && slashed[end - 1] === '/') end -= 1
  return slashed.slice(0, end)
}

export function moduleDirectoryForTarget(session: Pick<GoIDESession, 'project'>, target: GoIDERunTarget): string | null {
  const moduleDir = normalize(target.moduleDir)
  for (const candidate of [session.project.realPath, session.project.rootPath]) {
    const root = normalize(candidate)
    if (moduleDir.toLocaleLowerCase() === root.toLocaleLowerCase()) return ''
    if (moduleDir.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) return moduleDir.slice(root.length + 1)
  }
  return null
}

export function preferredRunTarget(
  session: Pick<GoIDESession, 'project'>,
  targets: readonly GoIDERunTarget[],
  activeRelativePath: string | null,
): GoIDERunTarget | null {
  if (targets.length === 1) return targets[0]
  if (activeRelativePath) {
    const scope = moduleScopeFor(session, activeRelativePath)
    const active = targets.find((target) => moduleDirectoryForTarget(session, target) === scope.moduleDirectory && target.package === scope.packageTarget)
    if (active) return active
  }
  const conventional = targets.find((target) => {
    const unit = session.project.units.find((candidate) => candidate.language === 'go'
      && candidate.kind === 'module'
      && normalize(candidate.root).toLocaleLowerCase() === normalize(target.moduleDir).toLocaleLowerCase())
    const modulePath = unit?.name || normalize(target.moduleDir)
    const moduleBase = modulePath.slice(modulePath.lastIndexOf('/') + 1)
    return target.package === `./cmd/${moduleBase}`
  })
  return conventional ?? null
}

export function configurationForRunTarget(session: Pick<GoIDESession, 'id' | 'project'>, target: GoIDERunTarget): GoIDERunConfiguration | null {
  const workingDirectory = moduleDirectoryForTarget(session, target)
  if (workingDirectory === null) return null
  return {
    id: '', sessionId: session.id, name: `Run ${target.label}`, language: 'go',
    kind: GoIDERunConfigurationKind.RunKindPackage, target: target.package,
    files: [], binaryPath: '', workingDirectory, goArguments: [], programArguments: [],
    buildTags: [], environment: [], docker: {}, shared: true, order: 0, createdAt: '', updatedAt: '',
  } as GoIDERunConfiguration
}
