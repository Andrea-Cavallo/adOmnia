// Local storage maintenance — free up space when the quota banner fires and
// reset everything when local data gets into a bad state.
// All adOmnia local state lives under the `adomnia.` localStorage prefix, so we
// sweep by prefix instead of hardcoding every key.

import { useTabsStore } from '@/stores/tabs'

const PREFIX = 'adomnia.'

/** Disposable data — histories, event logs, caches. Safe to drop to reclaim space. */
const DISPOSABLE_RE = /^adomnia\..*(history|events|cache|\.log)/i

/** UTF-16 byte estimate of everything adOmnia keeps in localStorage. */
export function localUsageBytes(): number {
  let bytes = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(PREFIX)) continue
    bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2
  }
  return bytes
}

/** Browser-reported usage/quota (bbolt + localStorage + caches). Best-effort. */
export async function estimateQuota(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

/**
 * Ask the browser for persistent storage. Persistent origins get a larger quota
 * and are never evicted under storage pressure — this is the "more space" lever.
 * Safe to call repeatedly; resolves to whether persistence is granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Drop disposable data (call/response history, event logs, caches) without
 * touching collections, environments, settings or saved workspaces.
 * Returns the number of bytes reclaimed from localStorage.
 */
export function freeUpSpace(): number {
  const before = localUsageBytes()
  try { useTabsStore.getState().clearResponseHistory() } catch { /* store not ready */ }
  for (const k of Object.keys(localStorage)) {
    if (DISPOSABLE_RE.test(k)) localStorage.removeItem(k)
  }
  sessionStorage.removeItem('adomnia.quota.exceeded')
  return Math.max(0, before - localUsageBytes())
}

/**
 * Nuke ALL adOmnia local state and reload. Use when local data is corrupted.
 * Does not touch the backend bbolt store — export a snapshot first from the
 * Storage panel if those entries also need clearing.
 */
export function resetLocalData(): void {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  }
  sessionStorage.removeItem('adomnia.quota.exceeded')
  location.reload()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
