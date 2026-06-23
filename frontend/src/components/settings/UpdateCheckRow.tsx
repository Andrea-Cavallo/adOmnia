import { useState } from 'react'
import { RefreshCw, CheckCircle2, Sparkles, AlertCircle } from 'lucide-react'
import { CheckForUpdate } from '@/wailsjs/go/main/App'
import { BrowserOpenURL } from '@/wailsjs/runtime/runtime'

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'dev' }
  | { kind: 'error' }

/**
 * Manual "Check for updates" row for the About settings section. Lets users who
 * were offline at startup re-check, and confirms when they're up to date.
 * Notify-only — opens the release page, never downloads.
 */
export function UpdateCheckRow() {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const check = async () => {
    setState({ kind: 'checking' })
    try {
      const info = await CheckForUpdate()
      if (info.isDev) setState({ kind: 'dev' })
      else if (info.updateAvailable)
        setState({ kind: 'available', version: info.latestVersion, url: info.releaseUrl })
      else setState({ kind: 'current' })
    } catch {
      setState({ kind: 'error' })
    }
  }

  return (
    <div className="py-2 px-1 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {state.kind === 'current' && <CheckCircle2 size={13} className="shrink-0 text-emerald-500" />}
        {state.kind === 'available' && <Sparkles size={13} className="shrink-0 text-accent" />}
        {state.kind === 'error' && <AlertCircle size={13} className="shrink-0 text-amber-500" />}
        <span className="text-xs text-text-2 truncate">
          {state.kind === 'idle' && 'Check GitHub for a newer release'}
          {state.kind === 'checking' && 'Checking…'}
          {state.kind === 'current' && "You're on the latest version"}
          {state.kind === 'dev' && 'Development build — update check skipped'}
          {state.kind === 'error' && 'Could not reach GitHub'}
          {state.kind === 'available' && (
            <button
              onClick={() => BrowserOpenURL(state.url)}
              className="text-accent hover:underline"
            >
              {state.version} available — view release
            </button>
          )}
        </span>
      </div>
      <button
        onClick={check}
        disabled={state.kind === 'checking'}
        className="shrink-0 flex items-center gap-1.5 rounded-md border border-border-2 bg-surface-2 px-2 py-1 text-[11px] text-text-1 hover:bg-surface-3 disabled:opacity-50 transition-colors"
      >
        <RefreshCw size={12} className={state.kind === 'checking' ? 'animate-spin' : ''} />
        Check for updates
      </button>
    </div>
  )
}
