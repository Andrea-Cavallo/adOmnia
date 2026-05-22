import { useState, useEffect } from 'react'
import { useEnvironmentsStore } from '@/stores/environments'
import { useTabsStore } from '@/stores/tabs'

export function StatusBar() {
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const environments = useEnvironmentsStore((s) => s.environments)
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const responseHistory = useTabsStore((s) => s.responseHistory)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail
      setSaveError(msg)
      setTimeout(() => setSaveError(null), 5000)
    }
    window.addEventListener('adomnia:save-error', handler)
    return () => window.removeEventListener('adomnia:save-error', handler)
  }, [])

  const activeEnv = environments.find((e) => e.id === activeEnvId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const response = activeTab?.response

  return (
    <footer className="h-6 flex items-center justify-between px-3 bg-surface-1 border-t border-border-1 text-[11px] text-text-3 select-none">
      <div className="flex items-center gap-3">
        {response && !response.error && (
          <>
            <span className={response.status >= 400 ? 'text-error' : response.status >= 200 ? 'text-success' : 'text-text-3'}>
              {response.status} {response.statusText}
            </span>
            <span>{response.ms} ms</span>
            <span>{response.size < 1024 ? `${response.size} B` : `${(response.size / 1024).toFixed(1)} KB`}</span>
          </>
        )}
        {response?.error && <span className="text-error">{response.error.code}</span>}
        {!response && !saveError && <span>Ready</span>}
        {saveError && <span className="text-error">Save error: {saveError}</span>}
        {responseHistory.length > 0 && (
          <span className="flex items-center gap-1 text-text-4">
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            cache {responseHistory.length} reqs
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {activeEnv ? (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
            {activeEnv.name}
          </span>
        ) : (
          <span>No Environment</span>
        )}
      </div>
    </footer>
  )
}
