import type { LiveFrame, LiveSession } from '@/lib/devsession-api'
import { useAppStore } from '@/stores/app'
import { useTabsStore } from '@/stores/tabs'
import { showEntityNotice } from '@/lib/entities/notice'

/**
 * Opens a frame of a live session in Go Studio: the right project, file,
 * line and debugger, without closing the API tab the developer came from.
 */
export async function openFrameInGoStudio(session: LiveSession, frame?: LiveFrame | null, options: { switchRail?: boolean } = {}): Promise<void> {
  const target = frame ?? session.pause ?? null
  const opened = await openLocationInGoStudio(session.goSessionId, target, { ...options, label: session.service })
  if (!opened || session.kind !== 'debug') return
  const { useGoIDEDebugStore } = await import('@/stores/goideDebug')
  useGoIDEDebugStore.getState().selectDebugger(session.goSessionId, session.resourceId)
}

/** Opens a file:line of a gO project (relative path, or an absolute one outside the project). */
export async function openLocationInGoStudio(goSessionId: string, target: LiveFrame | null, options: { switchRail?: boolean; label?: string } = {}): Promise<boolean> {
  const { useGoIDEStore } = await import('@/stores/goide')
  const goide = useGoIDEStore.getState()
  if (!goide.initialized) await goide.initialize()
  if (!useGoIDEStore.getState().sessions.some((s) => s.id === goSessionId)) {
    showEntityNotice(`The ${options.label ?? 'service'} project is no longer open in Go Studio.`)
    return false
  }
  if (options.switchRail !== false) useAppStore.getState().setActiveRail('goide')
  else useAppStore.getState().keepPanel('goide')
  if (useGoIDEStore.getState().activeSessionId !== goSessionId) await useGoIDEStore.getState().selectSession(goSessionId)
  if (!target) return true
  if (target.relativePath && !target.relativePath.startsWith('..')) {
    await useGoIDEStore.getState().openLocation(target.relativePath, target.line, 1)
  } else if (target.file) {
    await useGoIDEStore.getState().openExternalLocation(target.file, target.line, 1)
  }
  return true
}

/** Goes back to the API tab that sent a request. */
export function openRequestTab(tabId: string | undefined): void {
  if (!tabId) return
  const tabs = useTabsStore.getState()
  if (!tabs.tabs.some((tab) => tab.id === tabId)) {
    showEntityNotice('The request tab was closed.')
    return
  }
  useAppStore.getState().setActiveRail('collections')
  tabs.setActiveTab(tabId)
}

/**
 * Split Debug View: Go Studio (paused code, variables) next to the API
 * request that stopped there. Opens on demand or when a request hits a
 * breakpoint while the developer is in the API workspace.
 */
export async function openSplitDebugView(tabId: string, session: LiveSession | null): Promise<void> {
  const tabs = useTabsStore.getState()
  if (tabs.tabs.some((tab) => tab.id === tabId)) tabs.setActiveTab(tabId)
  const app = useAppStore.getState()
  app.keepPanel('goide')
  app.keepPanel('collections')
  if (app.activeRail !== 'collections' && app.activeRail !== 'goide') app.setActiveRail('collections')
  app.setSplitView(true)
  if (session) await openFrameInGoStudio(session, null, { switchRail: false })
}
