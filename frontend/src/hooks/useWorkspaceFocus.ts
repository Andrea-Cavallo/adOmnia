import { useMemo } from 'react'
import { useApiCodeLinkStore } from '@/lib/api-code-link/linkStore'
import { deriveFocus, useWorkspaceFocusStore, type FocusSources, type WorkspaceFocus } from '@/lib/workspaceFocus'
import { useDevSessionStore } from '@/stores/devSession'
import { useTabsStore } from '@/stores/tabs'

/** Reads every source of the focus; each is a stable store reference, so this never loops. */
export function focusSourcesNow(): FocusSources {
  const link = useApiCodeLinkStore.getState()
  const live = useDevSessionStore.getState()
  return {
    link: link.link,
    linkStale: link.stale,
    activeTabId: useTabsStore.getState().activeTabId,
    runs: live.runs,
    runByTab: live.runByTab,
    sessions: live.sessions,
    queries: live.queries,
    selectedQueryId: useWorkspaceFocusStore.getState().selectedQueryId,
  }
}

/** The Workspace Focus, re-derived only when one of its sources changes. */
export function useWorkspaceFocus(): WorkspaceFocus {
  const link = useApiCodeLinkStore((s) => s.link)
  const linkStale = useApiCodeLinkStore((s) => s.stale)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const runs = useDevSessionStore((s) => s.runs)
  const runByTab = useDevSessionStore((s) => s.runByTab)
  const sessions = useDevSessionStore((s) => s.sessions)
  const queries = useDevSessionStore((s) => s.queries)
  const selectedQueryId = useWorkspaceFocusStore((s) => s.selectedQueryId)
  return useMemo(
    () => deriveFocus({ link, linkStale, activeTabId, runs, runByTab, sessions, queries, selectedQueryId }),
    [link, linkStale, activeTabId, runs, runByTab, sessions, queries, selectedQueryId],
  )
}
