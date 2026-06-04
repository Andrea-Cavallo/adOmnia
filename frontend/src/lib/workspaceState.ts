import type { Collection, Environment, Tab } from '@/lib/types'
import type { AppSettings } from '@/stores/settings'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { saveFlowDefinitions, type SavedFlowDefinition } from '@/lib/flowStorage'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface WorkspaceState {
  workspace?: { id: string; name: string }
  openTabs?: Tab[]
  activeTabId?: string | null
  collections?: Collection[]
  environments?: Environment[]
  activeEnvId?: string | null
  settings?: AppSettings
  flows?: SavedFlowDefinition[]
  dockerLab?: unknown
  websocket?: unknown
}

export async function applyWorkspaceState(state: WorkspaceState): Promise<SavedFlowDefinition[] | undefined> {
  if (Array.isArray(state.openTabs)) {
    const workspaceId = useCollectionsStore.getState().activeWorkspaceId
    const workspaceTabs = state.openTabs.map((tab) => ({ ...tab, workspaceId }))
    const otherTabs = useTabsStore.getState().tabs.filter((tab) => tab.workspaceId !== workspaceId)
    const activeTabId = workspaceTabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId ?? null
      : workspaceTabs[0]?.id ?? null
    useTabsStore.setState({
      tabs: [...otherTabs, ...workspaceTabs],
      activeTabId,
    })
    useTabsStore.getState().save()
  }
  if (Array.isArray(state.collections)) {
    useCollectionsStore.getState().replaceCollections(state.collections)
  }
  if (Array.isArray(state.environments)) {
    useEnvironmentsStore.setState({
      environments: state.environments,
      activeEnvId: state.activeEnvId ?? null,
      loaded: true,
    })
    useEnvironmentsStore.getState().save()
  }
  if (state.settings) {
    useSettingsStore.setState({ settings: state.settings, loaded: true })
    useSettingsStore.getState().save()
  }
  const flows = Array.isArray(state.flows) ? await saveFlowDefinitions(state.flows) : undefined
  if (state.dockerLab) {
    safeSetItem('adomnia.dockerlab.last', JSON.stringify(state.dockerLab))
  }
  if (state.websocket) {
    safeSetItem('adomnia.websocket', JSON.stringify(state.websocket))
  }
  return flows
}
