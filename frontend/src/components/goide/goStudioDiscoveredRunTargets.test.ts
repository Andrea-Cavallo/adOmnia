import { describe, expect, it } from 'vitest'
import type { GoIDERunTarget, GoIDESession } from '@/lib/goide-api'
import { configurationForRunTarget, preferredRunTarget } from './goStudioDiscoveredRunTargets'

const session = {
  id: 's1',
  project: {
    realPath: 'C:\\repo', rootPath: 'C:\\repo',
    units: [{ language: 'go', kind: 'module', root: 'C:\\repo\\services\\api', name: 'example/api', manifest: 'C:\\repo\\services\\api\\go.mod' }],
  },
} as GoIDESession

const targets: GoIDERunTarget[] = [
  { dir: 'C:\\repo\\cmd\\worker', moduleDir: 'C:\\repo', package: './cmd/worker', label: 'worker' } as GoIDERunTarget,
  { dir: 'C:\\repo\\services\\api\\cmd', moduleDir: 'C:\\repo\\services\\api', package: './cmd', label: 'api' } as GoIDERunTarget,
]

describe('discovered run targets', () => {
  it('prefers the package of the active file across nested modules', () => {
    expect(preferredRunTarget(session, targets, 'services/api/cmd/main.go')?.label).toBe('api')
  })

  it('prefers cmd/<module-name> when no active file identifies an entry point', () => {
    const candidates = [
      { dir: 'C:\\repo\\services\\api\\cmd\\worker', moduleDir: 'C:\\repo\\services\\api', package: './cmd/worker', label: 'worker' },
      { dir: 'C:\\repo\\services\\api\\cmd\\api', moduleDir: 'C:\\repo\\services\\api', package: './cmd/api', label: 'api' },
    ] as GoIDERunTarget[]
    expect(preferredRunTarget(session, candidates, null)?.package).toBe('./cmd/api')
  })

  it('creates a shared configuration scoped to the owning module', () => {
    expect(configurationForRunTarget(session, targets[1])).toMatchObject({
      name: 'Run api', target: './cmd', workingDirectory: 'services/api', shared: true,
    })
  })
})
