import { GoIDERunConfigurationKind, type GoIDERunConfiguration } from '@/lib/goide-api'

interface WorkspaceExecution {
  id: string
  sessionId: string
  status: string
}

interface WorkspaceContextEntity {
  kind: string
  label?: string
  attrs?: Record<string, string | undefined>
  sources?: Array<{ detector: string; file: string }>
}

export interface DetectedWorkspaceService {
  name: string
  directory: string
}

const WORKSPACE_CONFIG_PATTERN = /\b(start|run|launch)?\s*(workspace|local\s+env|local\s+environment|dev\s+env|development\s+environment|stack)\b/i

function configRank(config: GoIDERunConfiguration): number {
  let rank = 0
  if (config.pinned) rank += 100
  if (/^start\s+workspace$/i.test(config.name.trim())) rank += 50
  if (/\bworkspace\b/i.test(config.name)) rank += 25
  if (/\b(local|dev|development)\s+(env|environment)\b/i.test(config.name)) rank += 20
  if (/\bstack\b/i.test(config.name)) rank += 10
  return rank
}

export function workspaceStartConfiguration(configs: readonly GoIDERunConfiguration[]): GoIDERunConfiguration | null {
  const candidates = configs
    .filter((config) => config.kind === GoIDERunConfigurationKind.RunKindCompound && WORKSPACE_CONFIG_PATTERN.test(config.name))
    .sort((left, right) => configRank(right) - configRank(left) || left.order - right.order || left.name.localeCompare(right.name))
  return candidates[0] ?? null
}

function emptyConfiguration(sessionId: string): GoIDERunConfiguration {
  return {
    id: '',
    sessionId,
    name: '',
    kind: GoIDERunConfigurationKind.RunKindPackage,
    target: '',
    files: [],
    binaryPath: '',
    workingDirectory: '',
    goArguments: [],
    programArguments: [],
    buildTags: [],
    environment: [],
    docker: {},
    compound: [],
    pinned: true,
    shared: true,
    order: 0,
    createdAt: '',
    updatedAt: '',
  } as GoIDERunConfiguration
}

export function workspaceStartDraft(sessionId: string, compound: string[] = [], preRun: string[] = []): GoIDERunConfiguration {
  return {
    ...emptyConfiguration(sessionId),
    name: 'Start workspace',
    kind: GoIDERunConfigurationKind.RunKindCompound,
    compound,
    preRun,
  }
}

/** A migration or seed task detected in the project (devcontext `task` entity). */
export interface DetectedWorkspaceTask {
  role: 'migration' | 'seed'
  runner: string
  name: string
  /** go: package directory; make: Makefile path; SQL tools: migrations folder. */
  path: string
  /** make: the target to run. */
  target: string
}

/** Detected tasks, migrations before seeds. */
export function detectedWorkspaceTasks(entities: readonly WorkspaceContextEntity[]): DetectedWorkspaceTask[] {
  const tasks: DetectedWorkspaceTask[] = []
  for (const entity of entities) {
    const role = entity.attrs?.role
    if (entity.kind !== 'task' || (role !== 'migration' && role !== 'seed')) continue
    const runner = entity.attrs?.runner ?? ''
    tasks.push({ role, runner, name: entity.label?.trim() || runner, path: (entity.attrs?.file ?? entity.attrs?.dir ?? '').replace(/\\/g, '/'), target: entity.attrs?.target ?? '' })
  }
  return tasks.sort((left, right) => (left.role === right.role ? left.name.localeCompare(right.name) : left.role === 'migration' ? -1 : 1))
}

/** go and make tasks run as-is; SQL migration folders need their tool and DSN configured by hand. */
export function isRunnableTask(task: DetectedWorkspaceTask): boolean {
  return task.runner === 'go' || task.runner === 'make'
}

export function taskConfiguration(sessionId: string, task: DetectedWorkspaceTask): GoIDERunConfiguration {
  const label = task.role === 'migration' ? 'Migrate' : 'Seed'
  if (task.runner === 'make') {
    return { ...emptyConfiguration(sessionId), name: `${label}: make ${task.target}`, kind: GoIDERunConfigurationKind.RunKindMake, target: task.path, programArguments: [task.target], pinned: false }
  }
  return { ...emptyConfiguration(sessionId), name: `${label}: ${task.path}`, kind: GoIDERunConfigurationKind.RunKindPackage, target: `./${task.path.replace(/^\.\//, '')}`, pinned: false }
}

export function taskConfigurationForDetected(configs: readonly GoIDERunConfiguration[], task: DetectedWorkspaceTask): GoIDERunConfiguration | null {
  if (task.runner === 'make') {
    return configs.find((config) => config.kind === GoIDERunConfigurationKind.RunKindMake
      && config.target.replace(/\\/g, '/') === task.path && (config.programArguments ?? [])[0] === task.target) ?? null
  }
  const target = `./${task.path.replace(/^\.\//, '')}`
  return configs.find((config) => config.kind === GoIDERunConfigurationKind.RunKindPackage && config.target === target) ?? null
}

export function detectedComposeFiles(entities: readonly WorkspaceContextEntity[]): string[] {
  const files = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== 'service') continue
    for (const source of entity.sources ?? []) {
      if (source.detector === 'compose' && source.file.trim()) files.add(source.file.replace(/\\/g, '/'))
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right))
}

export function composeConfigurationForFile(sessionId: string, file: string): GoIDERunConfiguration {
  return {
    ...emptyConfiguration(sessionId),
    name: `Compose: ${file}`,
    kind: GoIDERunConfigurationKind.RunKindDockerCompose,
    target: file,
    programArguments: ['up'],
    shared: true,
  }
}

export function composeConfigurationForDetectedFile(configs: readonly GoIDERunConfiguration[], file: string): GoIDERunConfiguration | null {
  const normalized = file.replace(/\\/g, '/').toLowerCase()
  return configs.find((config) => config.kind === GoIDERunConfigurationKind.RunKindDockerCompose
    && config.target.replace(/\\/g, '/').toLowerCase() === normalized
    && (config.programArguments?.[0] ?? 'up') === 'up') ?? null
}

export function detectedGoServices(entities: readonly WorkspaceContextEntity[]): DetectedWorkspaceService[] {
  const byDirectory = new Map<string, DetectedWorkspaceService>()
  for (const entity of entities) {
    if (entity.kind !== 'service' || entity.attrs?.origin !== 'go') continue
    const directory = (entity.attrs.dir ?? '').replace(/\\/g, '/').replace(/^\.\//, '') || '.'
    if (!byDirectory.has(directory)) byDirectory.set(directory, { name: entity.label?.trim() || directory, directory })
  }
  return [...byDirectory.values()].sort((left, right) => left.directory.localeCompare(right.directory))
}

export function serviceConfigurationForDirectory(sessionId: string, service: DetectedWorkspaceService): GoIDERunConfiguration {
  return {
    ...emptyConfiguration(sessionId),
    name: `Service: ${service.name}`,
    kind: GoIDERunConfigurationKind.RunKindPackage,
    target: service.directory === '.' ? '.' : `./${service.directory}`,
    shared: true,
    restartOnSave: true,
  }
}

export function serviceConfigurationForDetectedDirectory(configs: readonly GoIDERunConfiguration[], directory: string): GoIDERunConfiguration | null {
  const target = directory === '.' ? '.' : `./${directory.replace(/\\/g, '/').replace(/^\.\//, '')}`
  return configs.find((config) => config.kind === GoIDERunConfigurationKind.RunKindPackage
    && (config.workingDirectory || '') === ''
    && (config.target || '.') === target) ?? null
}

export function activeWorkspaceRunIds(executions: readonly WorkspaceExecution[], sessionId: string): string[] {
  return executions.filter((execution) => execution.sessionId === sessionId && execution.status === 'running').map((execution) => execution.id)
}

export function requiredSecretKeysForRun(config: GoIDERunConfiguration | null, configs: readonly GoIDERunConfiguration[]): string[] {
  const keys = new Set<string>()
  const collect = (item: GoIDERunConfiguration | undefined) => {
    for (const entry of [...(item?.environment ?? []), ...(item?.docker?.buildArgs ?? [])]) {
      if (entry.secret && entry.key) keys.add(entry.key)
    }
  }
  collect(config ?? undefined)
  if (config?.kind === GoIDERunConfigurationKind.RunKindCompound) {
    for (const id of config.compound ?? []) collect(configs.find((item) => item.id === id))
  }
  return [...keys]
}
