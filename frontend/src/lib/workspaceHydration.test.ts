import { describe, expect, it } from 'vitest'
import { isWorkspaceHydrated, type WorkspaceHydrationState } from './workspaceHydration'

const hydrated: WorkspaceHydrationState = {
  collections: true,
  tabs: true,
  environments: true,
  hosts: true,
}

describe('workspace hydration', () => {
  it('is ready only after every workspace store has loaded', () => {
    expect(isWorkspaceHydrated(hydrated)).toBe(true)

    for (const store of Object.keys(hydrated) as Array<keyof WorkspaceHydrationState>) {
      expect(isWorkspaceHydrated({ ...hydrated, [store]: false })).toBe(false)
    }
  })
})
