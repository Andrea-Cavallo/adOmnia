export interface WorkspaceHydrationState {
  collections: boolean
  tabs: boolean
  environments: boolean
  hosts: boolean
}

export function isWorkspaceHydrated(state: WorkspaceHydrationState): boolean {
  return state.collections && state.tabs && state.environments && state.hosts
}
