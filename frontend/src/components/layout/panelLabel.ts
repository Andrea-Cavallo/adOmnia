import type { RailItem } from '@/lib/navigation'
import { useT } from '@/lib/i18n'
import { useNavigationTranslation, useUiTranslation } from '@/lib/uiI18n'
import { useCollectionsStore } from '@/stores/collections'

/** Title shown for a module: the workspace name for the API workspace, the translated rail label otherwise. */
export function usePanelLabel(rail: RailItem, titleKey?: string): string {
  const tr = useUiTranslation()
  const nav = useNavigationTranslation()
  const workspaces = useCollectionsStore((s) => s.workspaces)
  const activeWorkspaceId = useCollectionsStore((s) => s.activeWorkspaceId)
  const t = useT()
  if (rail === 'collections') return workspaces.find((w) => w.id === activeWorkspaceId)?.name ?? tr('Workspace')
  return titleKey && titleKey in t.rail ? t.rail[titleKey as keyof typeof t.rail] : nav(titleKey || '')
}
