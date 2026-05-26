import type { Collection, Environment, Tab } from '@/lib/types'
import type { AppSettings } from '@/stores/settings'
import { useCollectionsStore, migrateCollections } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { saveFlowDefinitions, type SavedFlowDefinition } from '@/lib/flowStorage'
import { safeSetItem } from '@/lib/safeLocalStorage'

export interface WorkspaceState {
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
    useTabsStore.setState({
      tabs: state.openTabs,
      activeTabId: state.activeTabId ?? state.openTabs[0]?.id ?? null,
    })
    useTabsStore.getState().save()
  }
  if (Array.isArray(state.collections)) {
    useCollectionsStore.setState({ collections: migrateCollections(state.collections), loaded: true })
    useCollectionsStore.getState().save()
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
