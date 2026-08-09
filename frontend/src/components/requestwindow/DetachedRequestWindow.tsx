import { useCallback, useEffect, useRef, useState } from 'react'
import { ThemeProvider } from '@/components/themes/ThemeProvider'
import { RequestWorkspace } from '@/components/layout/MainArea'
import { EnvBar } from '@/components/environment/EnvBar'
import { useAppInit } from '@/hooks/useAppInit'
import { useAppearance } from '@/hooks/useAppearance'
import { useTabsStore, type TabViewState } from '@/stores/tabs'
import { useEnvironmentsStore } from '@/stores/environments'
import type { Tab } from '@/lib/types'
import { useUiTranslation } from '@/lib/uiI18n'
import {
  GetDetachedRequestSnapshot,
  UpdateDetachedRequestSnapshot,
} from '@/wailsjs/go/main/App'
import { WindowSetTitle } from '@/wailsjs/runtime/runtime'
import { EventsOn } from '@/wailsjs/runtime/runtime'

type RequestWindowSnapshot = {
  tab: Tab
  viewState?: TabViewState
  environmentId?: string | null
}

type RequestWindowSession = {
  tabId: string
  snapshot: string
}

export function DetachedRequestWindow() {
  const tr = useUiTranslation()
  useAppInit()
  useAppearance()

  const tabId = new URLSearchParams(window.location.search).get('tab') ?? ''
  const pane = new URLSearchParams(window.location.search).get('pane')
  const standalonePane = pane === 'request' || pane === 'response' ? pane : undefined
  const tabsLoaded = useTabsStore((state) => state.loaded)
  const environments = useEnvironmentsStore((state) => state.environments)
  const activeEnvId = useEnvironmentsStore((state) => state.activeEnvId)
  const setActiveEnv = useEnvironmentsStore((state) => state.setActiveEnv)
  const addEnvironment = useEnvironmentsStore((state) => state.addEnvironment)
  const deleteEnvironment = useEnvironmentsStore((state) => state.deleteEnvironment)
  const renameEnvironment = useEnvironmentsStore((state) => state.renameEnvironment)
  const updateVariables = useEnvironmentsStore((state) => state.updateVariables)
  const setEnvironmentPrivate = useEnvironmentsStore((state) => state.setEnvironmentPrivate)
  const [ready, setReady] = useState(false)
  const hydratedRef = useRef(false)
  const lastSnapshotRef = useRef('')
  const applyingRemoteSnapshotRef = useRef(false)

  useEffect(() => {
    if (!tabId || !tabsLoaded || hydratedRef.current) return
    let cancelled = false
    void GetDetachedRequestSnapshot(tabId)
      .then((raw) => {
        if (cancelled) return
        const snapshot = JSON.parse(raw) as RequestWindowSnapshot
        if (!snapshot?.tab?.id) throw new Error('Invalid detached request snapshot')
        useTabsStore.getState().replaceTabSnapshot(snapshot.tab, snapshot.viewState)
        useTabsStore.getState().setDetached(tabId, false)
        useTabsStore.getState().setActiveTab(tabId)
        if ('environmentId' in snapshot) useEnvironmentsStore.getState().setActiveEnv(snapshot.environmentId ?? null)
        const requestTitle = snapshot.tab.request.name || snapshot.tab.request.url || tr('API Request')
        WindowSetTitle(standalonePane ? `${requestTitle} - ${standalonePane === 'request' ? 'Request' : 'Response'} - adOmnia` : requestTitle)
        lastSnapshotRef.current = raw
        hydratedRef.current = true
        setReady(true)
      })
      .catch((error) => {
        console.error('Could not load detached request window', error)
        if (!cancelled) setReady(true)
      })
    return () => { cancelled = true }
  }, [standalonePane, tabId, tabsLoaded, tr])

  const publishSnapshot = useCallback(async (force = false) => {
    if (!tabId) return
    if (applyingRemoteSnapshotRef.current) return
    const state = useTabsStore.getState()
    const tab = state.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    const snapshot = JSON.stringify({
      tab,
      viewState: state.getViewState(tabId),
      environmentId: useEnvironmentsStore.getState().activeEnvId,
    })
    if (!force && snapshot === lastSnapshotRef.current) return
    lastSnapshotRef.current = snapshot
    await UpdateDetachedRequestSnapshot(tabId, snapshot)
  }, [tabId])

  const applyRemoteSnapshot = useCallback((value: unknown) => {
    const session = value as RequestWindowSession
    if (!session || session.tabId !== tabId || typeof session.snapshot !== 'string') return
    try {
      const snapshot = JSON.parse(session.snapshot) as RequestWindowSnapshot
      if (!snapshot?.tab?.id) return
      applyingRemoteSnapshotRef.current = true
      lastSnapshotRef.current = session.snapshot
      useTabsStore.getState().replaceTabSnapshot(snapshot.tab, snapshot.viewState)
      if ('environmentId' in snapshot) useEnvironmentsStore.getState().setActiveEnv(snapshot.environmentId ?? null)
      window.setTimeout(() => { applyingRemoteSnapshotRef.current = false }, 0)
    } catch {
      // A malformed peer update must not disturb the detached workspace.
    }
  }, [tabId])

  useEffect(() => {
    if (!tabId || !ready) return
    const unsubscribeTabs = useTabsStore.subscribe(() => { void publishSnapshot().catch(() => undefined) })
    const unsubscribeEnvironments = useEnvironmentsStore.subscribe(() => { void publishSnapshot().catch(() => undefined) })
    const persistBeforeClose = () => { void publishSnapshot(true).catch(() => undefined) }
    window.addEventListener('beforeunload', persistBeforeClose)
    return () => {
      unsubscribeTabs()
      unsubscribeEnvironments()
      window.removeEventListener('beforeunload', persistBeforeClose)
    }
  }, [publishSnapshot, ready, tabId])

  useEffect(() => {
    if (!tabId || !ready) return
    return EventsOn('request-window:updated', applyRemoteSnapshot)
  }, [applyRemoteSnapshot, ready, tabId])

  return (
    <ThemeProvider>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-surface-0">
        <EnvBar
          environments={environments}
          activeEnvId={activeEnvId}
          onSetActive={setActiveEnv}
          onAdd={(name) => { addEnvironment(name) }}
          onDelete={deleteEnvironment}
          onRename={renameEnvironment}
          onUpdateVars={updateVariables}
          onSetPrivate={setEnvironmentPrivate}
        />
        {ready
          ? <RequestWorkspace standaloneTabId={tabId} standalonePane={standalonePane} />
          : <div className="flex-1 grid place-items-center text-xs text-text-3">Loading…</div>}
      </div>
    </ThemeProvider>
  )
}
