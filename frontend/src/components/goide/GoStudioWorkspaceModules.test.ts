import { describe, expect, it } from 'vitest'
import type { WorkspaceModule } from '../../../bindings/adomnia/internal/goide/models'
import { workspaceDependents } from './GoStudioWorkspaceModules'

describe('workspaceDependents', () => {
  it('inverts the requires edges', () => {
    const modules = [
      { modulePath: 'x/api', directory: 'api', requires: ['x/core'], replaced: [] },
      { modulePath: 'x/tools', directory: 'tools', requires: ['x/core', 'x/api'], replaced: [] },
      { modulePath: 'x/core', directory: 'core', requires: [], replaced: [] },
    ] as unknown as WorkspaceModule[]
    expect(Object.fromEntries(workspaceDependents(modules))).toEqual({ 'x/core': ['x/api', 'x/tools'], 'x/api': ['x/tools'] })
  })
})
