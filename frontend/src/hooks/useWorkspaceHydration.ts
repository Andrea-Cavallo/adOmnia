import { useEffect, useRef, useState } from 'react'
import { useCollectionsStore } from '@/stores/collections'
import { useTabsStore } from '@/stores/tabs'
import { useEnvironmentsStore } from '@/stores/environments'
import { useHostsStore } from '@/stores/hosts'
import { isWorkspaceHydrated } from '@/lib/workspaceHydration'
import { markStartup } from '@/lib/startupPerformance'
import {
  DEFAULT_WORKSPACE_SHELL_DELAY_MS,
  DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS,
  loadWorkspaceStartupHint,
  workspaceShellTimingFromHint,
  type WorkspaceShellTiming,
} from '@/lib/startupHints'

export function useWorkspaceHydration(): boolean {
  const collections = useCollectionsStore((state) => state.loaded)
  const tabs = useTabsStore((state) => state.loaded)
  const environments = useEnvironmentsStore((state) => state.loaded)
  const hosts = useHostsStore((state) => state.loaded)

  return isWorkspaceHydrated({ collections, tabs, environments, hosts })
}

export type WorkspaceShellPhase = 'quiet' | 'skeleton' | 'ready'

export const WORKSPACE_SHELL_DELAY_MS = DEFAULT_WORKSPACE_SHELL_DELAY_MS
export const WORKSPACE_SHELL_MIN_VISIBLE_MS = DEFAULT_WORKSPACE_SHELL_MIN_VISIBLE_MS

export function remainingWorkspaceShellTime(
  shownAt: number,
  now: number,
  minVisibleMs = WORKSPACE_SHELL_MIN_VISIBLE_MS,
): number {
  return Math.max(0, minVisibleMs - (now - shownAt))
}

export function scheduleWorkspaceSkeleton(
  delayMs: number,
  show: () => void,
): () => void {
  const id = globalThis.setTimeout(show, delayMs)
  return () => globalThis.clearTimeout(id)
}

/** Avoid showing a loading animation for fast hydration. Once the skeleton is
 * visible, hold it briefly so it reads as stable feedback instead of a flash. */
export function useWorkspaceHydrationShell(hydrated: boolean): WorkspaceShellPhase {
  const [phase, setPhase] = useState<WorkspaceShellPhase>(() => hydrated ? 'ready' : 'quiet')
  const shownAtRef = useRef<number | null>(null)
  const timingRef = useRef<WorkspaceShellTiming | null>(null)
  if (timingRef.current === null) {
    timingRef.current = workspaceShellTimingFromHint(loadWorkspaceStartupHint())
  }
  const timing = timingRef.current

  useEffect(() => {
    if (phase === 'ready') return

    if (!hydrated) {
      if (phase !== 'quiet') return
      return scheduleWorkspaceSkeleton(timing.delayMs, () => {
        shownAtRef.current = performance.now()
        markStartup('startup:skeleton-shown')
        setPhase('skeleton')
      })
    }

    const shownAt = shownAtRef.current
    if (shownAt === null) {
      setPhase('ready')
      return
    }

    const remaining = remainingWorkspaceShellTime(shownAt, performance.now(), timing.minVisibleMs)
    if (remaining === 0) {
      markStartup('startup:skeleton-hidden')
      setPhase('ready')
      return
    }
    const id = window.setTimeout(() => {
      markStartup('startup:skeleton-hidden')
      setPhase('ready')
    }, remaining)
    return () => window.clearTimeout(id)
  }, [hydrated, phase, timing])

  return phase
}
