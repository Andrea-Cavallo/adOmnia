import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { CheckForUpdate } from '@/wailsjs/go/main/App'
import { BrowserOpenURL } from '@/wailsjs/runtime/runtime'

/**
 * Notify-only update banner. On mount it asks the Go backend to check the latest
 * GitHub release (the only release-related network call, skipped in `wails dev`).
 * If a newer version exists and the user hasn't already dismissed it, a banner
 * offers a one-click link to the release page. No download, no auto-update.
 *
 * ponytail: dismissals are remembered per-version in localStorage so we don't
 * nag on every launch. Assisted download is the upgrade path if asked.
 */
const SKIP_KEY = 'adomnia.update.skippedVersion'

export function UpdateBanner() {
  const [latest, setLatest] = useState<{ version: string; url: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    CheckForUpdate()
      .then((info) => {
        if (cancelled || info.isDev || !info.updateAvailable) return
        if (localStorage.getItem(SKIP_KEY) === info.latestVersion) return
        setLatest({ version: info.latestVersion, url: info.releaseUrl })
      })
      .catch(() => {
        // Offline or GitHub unreachable — silently skip. Update checks are
        // best-effort and must never disrupt a local-first session.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!latest) return null

  const dismiss = () => {
    localStorage.setItem(SKIP_KEY, latest.version)
    setLatest(null)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        flex items-center gap-3 px-4 py-2
        bg-accent/15 border-b border-accent/30
        text-accent text-xs font-medium
        select-none
      "
    >
      <Sparkles size={14} className="shrink-0" />
      <span className="flex-1">
        <strong>adOmnia {latest.version} is available.</strong>{' '}
        <button
          onClick={() => BrowserOpenURL(latest.url)}
          className="underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          View the release and download
        </button>
        .
      </span>
      <button
        onClick={dismiss}
        title="Dismiss until the next release"
        className="shrink-0 rounded p-0.5 hover:bg-accent/20 transition-colors"
        aria-label="Dismiss update notice"
      >
        <X size={13} />
      </button>
    </div>
  )
}
