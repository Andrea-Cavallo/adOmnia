import { describe, expect, it } from 'vitest'
import { GoIDERunConfigurationKind, type GoIDERunConfiguration } from '@/lib/goide-api'
import {
  activeWorkspaceRunIds,
  composeConfigurationForDetectedFile,
  composeConfigurationForFile,
  detectedComposeFiles,
  detectedGoServices,
  requiredSecretKeysForRun,
  serviceConfigurationForDetectedDirectory,
  serviceConfigurationForDirectory,
  workspaceStartConfiguration,
  workspaceStartDraft,
  detectedWorkspaceTasks,
  isRunnableTask,
  taskConfiguration,
  taskConfigurationForDetected,
} from './goStudioWorkspaceStart'

const config = (partial: Partial<GoIDERunConfiguration>): GoIDERunConfiguration => ({
  id: partial.id ?? 'id',
  sessionId: partial.sessionId ?? 's1',
  name: partial.name ?? 'Config',
  kind: partial.kind ?? GoIDERunConfigurationKind.RunKindPackage,
  target: partial.target ?? '.',
  files: [],
  binaryPath: '',
  workingDirectory: '',
  goArguments: [],
  programArguments: [],
  buildTags: [],
  environment: [],
  docker: {},
  order: partial.order ?? 0,
  createdAt: '',
  updatedAt: '',
  ...partial,
} as GoIDERunConfiguration)

describe('Go Studio workspace start helpers', () => {
  it('selects an explicit compound workspace configuration first', () => {
    const generic = config({ id: 'stack', name: 'Dev stack', kind: GoIDERunConfigurationKind.RunKindCompound, order: 1 })
    const exact = config({ id: 'workspace', name: 'Start workspace', kind: GoIDERunConfigurationKind.RunKindCompound, order: 99 })
    const command = config({ id: 'command', name: 'Start workspace script', kind: GoIDERunConfigurationKind.RunKindCommand })

    expect(workspaceStartConfiguration([generic, command, exact])?.id).toBe('workspace')
  })

  it('creates a shared pinned compound draft without selecting processes implicitly', () => {
    const draft = workspaceStartDraft('s1')

    expect(draft.name).toBe('Start workspace')
    expect(draft.kind).toBe(GoIDERunConfigurationKind.RunKindCompound)
    expect(draft.compound).toEqual([])
    expect(draft.pinned).toBe(true)
    expect(draft.shared).toBe(true)
  })

  it('collects secrets from compound members before launch', () => {
    const api = config({ id: 'api', environment: [{ key: 'API_TOKEN', value: '', secret: true }] })
    const docker = config({ id: 'compose', docker: { buildArgs: [{ key: 'NPM_TOKEN', value: '', secret: true }] } })
    const stack = config({ id: 'stack', kind: GoIDERunConfigurationKind.RunKindCompound, compound: ['api', 'compose'] })

    expect(requiredSecretKeysForRun(stack, [api, docker, stack])).toEqual(['API_TOKEN', 'NPM_TOKEN'])
  })

  it('detects each compose file once from project context services', () => {
    const entities = [
      { kind: 'service', sources: [{ detector: 'compose', file: 'compose.yml' }] },
      { kind: 'service', sources: [{ detector: 'compose', file: 'compose.yml' }] },
      { kind: 'service', sources: [{ detector: 'compose', file: 'deploy\\docker-compose.dev.yml' }] },
      { kind: 'datasource', sources: [{ detector: 'compose', file: 'ignored.yml' }] },
    ]

    expect(detectedComposeFiles(entities)).toEqual(['compose.yml', 'deploy/docker-compose.dev.yml'])
  })

  it('creates a shared Compose Up configuration and reuses an equivalent existing one', () => {
    const draft = composeConfigurationForFile('s1', 'deploy/compose.yml')
    const existing = config({
      id: 'compose',
      kind: GoIDERunConfigurationKind.RunKindDockerCompose,
      target: 'deploy\\compose.yml',
      programArguments: ['up'],
    })

    expect(draft).toMatchObject({
      name: 'Compose: deploy/compose.yml',
      kind: GoIDERunConfigurationKind.RunKindDockerCompose,
      target: 'deploy/compose.yml',
      programArguments: ['up'],
      shared: true,
    })
    expect(composeConfigurationForDetectedFile([existing], 'deploy/compose.yml')?.id).toBe('compose')
  })

  it('detects Go main packages and creates reusable service configurations', () => {
    const services = detectedGoServices([
      { kind: 'service', label: 'api', attrs: { origin: 'go', dir: 'cmd\\api' } },
      { kind: 'service', label: 'api duplicate', attrs: { origin: 'go', dir: 'cmd/api' } },
      { kind: 'service', label: 'db', attrs: { origin: 'compose', dir: '.' } },
    ])
    const draft = serviceConfigurationForDirectory('s1', services[0])
    const existing = config({ id: 'api', kind: GoIDERunConfigurationKind.RunKindPackage, target: './cmd/api' })

    expect(services).toEqual([{ name: 'api', directory: 'cmd/api' }])
    expect(draft).toMatchObject({ name: 'Service: api', target: './cmd/api', shared: true, restartOnSave: true })
    expect(serviceConfigurationForDetectedDirectory([existing], 'cmd\\api')?.id).toBe('api')
  })

  it('selects every active process in the workspace session', () => {
    expect(activeWorkspaceRunIds([
      { id: 'compose', sessionId: 's1', status: 'running' },
      { id: 'api', sessionId: 's1', status: 'running' },
      { id: 'done', sessionId: 's1', status: 'exited' },
      { id: 'other', sessionId: 's2', status: 'running' },
    ], 's1')).toEqual(['compose', 'api'])
  })

  it('wires detected migrations and seeds as ordered Start workspace tasks', () => {
    const tasks = detectedWorkspaceTasks([
      { kind: 'task', label: 'make db-seed', attrs: { role: 'seed', runner: 'make', file: 'Makefile', target: 'db-seed' } },
      { kind: 'task', label: 'migrate', attrs: { role: 'migration', runner: 'go', dir: 'cmd/migrate' } },
      { kind: 'task', label: 'db/migrations', attrs: { role: 'migration', runner: 'golang-migrate', dir: 'db/migrations' } },
      { kind: 'service', label: 'api', attrs: { origin: 'go', dir: 'cmd/api' } },
    ])
    expect(tasks.map((task) => `${task.role}:${task.name}`)).toEqual(['migration:db/migrations', 'migration:migrate', 'seed:make db-seed'])
    expect(tasks.filter(isRunnableTask).map((task) => task.runner)).toEqual(['go', 'make'])

    const migrate = taskConfiguration('s1', tasks[1])
    expect(migrate).toMatchObject({ name: 'Migrate: cmd/migrate', kind: GoIDERunConfigurationKind.RunKindPackage, target: './cmd/migrate', shared: true })
    const seed = taskConfiguration('s1', tasks[2])
    expect(seed).toMatchObject({ name: 'Seed: make db-seed', kind: GoIDERunConfigurationKind.RunKindMake, target: 'Makefile', programArguments: ['db-seed'] })
    expect(taskConfigurationForDetected([config({ ...migrate, id: 'm' })], tasks[1])?.id).toBe('m')
    expect(taskConfigurationForDetected([config({ ...seed, id: 's', programArguments: ['other'] })], tasks[2])).toBeNull()

    expect(workspaceStartDraft('s1', ['a', 'b'], ['m'])).toMatchObject({ compound: ['a', 'b'], preRun: ['m'] })
  })
})

describe('workspace port conflicts', () => {
  it('reports declared ports taken by a foreign process, not by Docker for compose ports', async () => {
    const { declaredWorkspacePorts, workspacePortConflicts } = await import('./goStudioWorkspaceStart')
    const declared = declaredWorkspacePorts(
      [
        { kind: 'service', label: 'db', attrs: { origin: 'compose', ports: '5432:5432,127.0.0.1:6380:6379' } },
        { kind: 'service', label: 'api', attrs: { origin: 'go', dir: 'cmd/api' } },
      ],
      [config({ name: 'Service: api', port: 8080 }), config({ name: 'Image', docker: { ports: ['9000:80', '9100'] } as GoIDERunConfiguration['docker'] })],
    )
    expect(declared.map((item) => item.port)).toEqual([5432, 6380, 8080, 9000, 9100])
    const conflicts = workspacePortConflicts(declared, [
      { port: 5432, pid: 10, process: 'postgres.exe' },
      { port: 6380, pid: 11, process: 'com.docker.backend.exe' },
      { port: 8080, pid: 12, process: 'java.exe' },
      { port: 3000, pid: 13, process: 'node.exe' },
    ])
    expect(conflicts).toEqual([
      { port: 5432, declaredBy: 'Compose service db', pid: 10, process: 'postgres.exe' },
      { port: 8080, declaredBy: 'Service: api', pid: 12, process: 'java.exe' },
    ])
  })
})
