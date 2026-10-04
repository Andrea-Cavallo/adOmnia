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
})
