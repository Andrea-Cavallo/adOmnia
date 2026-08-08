import { useState, useEffect } from 'react'
import { AlertTriangle, HardDrive, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/stores/app'
import { freeUpSpace, formatBytes } from '@/lib/storageMaintenance'
import { useUiTranslation } from '@/lib/uiI18n'

/**
 * Persistent (non-auto-dismissing) banner shown when localStorage quota is exceeded.
 * The user must export their workspace to acknowledge the risk.
 */
export function StorageQuotaBanner() {
  const tr = useUiTranslation()
  const [visible, setVisible] = useState(false)
  const [freed, setFreed] = useState<number | null>(null)
  const setActiveRail = useAppStore((s) => s.setActiveRail)

  const handleFreeUp = () => {
    const bytes = freeUpSpace()
    setFreed(bytes)
    // Keep the banner up briefly to confirm, then dismiss.
    setTimeout(() => setVisible(false), 1800)
  }

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
        <strong>{tr('Storage quota exceeded.')}</strong>{' '}
        {freed !== null
          ? <>{tr('Freed')} {formatBytes(freed)} {tr('by clearing call history.')}</>
          : <>{tr('Some local data may not have been saved.')}{' '}
              <button
                onClick={() => setActiveRail('workspace')}
                className="underline underline-offset-2 hover:text-amber-300 transition-colors"
              >
                {tr('Export your workspace')}
              </button>{' '}
              {tr('to avoid data loss.')}</>
        }
      </span>
      {freed === null && (
        <button
          onClick={handleFreeUp}
          title={tr('Clear call/response history and caches to reclaim space')}
          className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-semibold hover:bg-amber-500/25 transition-colors"
        >
          <Trash2 size={12} /> {tr('Free up space')}
        </button>
      )}
      <button
        onClick={() => setVisible(false)}
        title={tr('Dismiss (data may still be at risk)')}
        className="shrink-0 rounded p-0.5 hover:bg-amber-500/20 transition-colors"
        aria-label={tr('Dismiss storage warning')}
      >
        <X size={13} />
      </button>
    </div>
  )
}
