import { useEffect, useState } from 'react'
import { serverUrl, sidecarFetch, useServerPort } from '@/lib/useServerPort'
import { useBrowserDebugStore } from '@/stores/browser-debug'
import { useTabsStore } from '@/stores/tabs'
import { browserTrafficRecords, composerTrafficRecords, proxyTrafficRecords, type AppTrafficRecord } from '@/lib/loginspector'

/**
 * Traffic adOmnia itself observed, restricted to calls that carry a
 * correlation/trace header. Browser and Composer come from their stores;
 * proxy traffic is read once from the local sidecar (it lives in the backend,
 * not in a store) and refreshed only when the panel asks again.
 */
export function useAppTraffic(enabled: boolean): AppTrafficRecord[] {
  const port = useServerPort()
  const browserEntries = useBrowserDebugStore((state) => state.entries)
  const responseHistory = useTabsStore((state) => state.responseHistory)
  const [proxyRecords, setProxyRecords] = useState<AppTrafficRecord[]>([])

  useEffect(() => {
    if (!enabled || !port) return
    let cancelled = false
    const url = serverUrl(port, '/proxy/traffic')
    if (!url) return
    sidecarFetch(url)
      .then((response) => response.json())
      .then((data: unknown) => {
        if (cancelled) return
        const entries = (data as { entries?: unknown })?.entries
        if (Array.isArray(entries)) setProxyRecords(proxyTrafficRecords(entries))
      })
      .catch(() => { /* the proxy may simply not be running */ })
    return () => { cancelled = true }
  }, [enabled, port])

  if (!enabled) return []
  return [
    ...browserTrafficRecords(browserEntries),
    ...composerTrafficRecords(responseHistory),
    ...proxyRecords,
  ]
}
