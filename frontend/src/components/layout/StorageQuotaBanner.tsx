import { useState, useEffect } from 'react'
import { AlertTriangle, HardDrive, X } from 'lucide-react'
import { useAppStore } from '@/stores/app'

/**
 * Persistent (non-auto-dismissing) banner shown when localStorage quota is exceeded.
 * The user must export their workspace to acknowledge the risk.
 */
export function StorageQuotaBanner() {
  const [visible, setVisible] = useState(false)
  const setActiveRail = useAppStore((s) => s.setActiveRail)

  useEffect(() => {
    // Show if a quota event fires at any point during the session.
    const handler = () => setVisible(true)
    window.addEventListener('adomnia:storage-quota-exceeded', handler)

    // Also restore visibility if we detected quota overflow in a previous load
    // (we persist a flag in sessionStorage so it survives hot-reloads, but NOT
    //  across cold restarts — a cold restart means localStorage was freed or the
    //  app is fresh, so the warning would be stale).
    if (sessionStorage.getItem('adomnia.quota.exceeded') === '1') {
      setVisible(true)
    }

    return () => window.removeEventListener('adomnia:storage-quota-exceeded', handler)
  }, [])

  // Persist flag so the banner reappears after hot reload in the same session
  useEffect(() => {
    if (visible) {
      sessionStorage.setItem('adomnia.quota.exceeded', '1')
    } else {
      sessionStorage.removeItem('adomnia.quota.exceeded')
    }
  }, [visible])

  if (!visible) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="
        flex items-center gap-3 px-4 py-2
        bg-amber-500/15 border-b border-amber-500/30
        text-amber-400 text-xs font-medium
        select-none
      "
    >
      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
      <HardDrive size={13} className="shrink-0 text-amber-400/70" />
      <span className="flex-1">
        <strong>Storage quota exceeded.</strong> Some local data may not have been saved.{' '}
        <button
          onClick={() => setActiveRail('workspace')}
          className="underline underline-offset-2 hover:text-amber-300 transition-colors"
        >
          Export your workspace now
        </button>{' '}
        to avoid data loss.
      </span>
      <button
        onClick={() => setVisible(false)}
        title="Dismiss (data may still be at risk)"
        className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
        aria-label="Dismiss storage warning"
      >
        <X size={13} />
      </button>
    </div>
  )
}
