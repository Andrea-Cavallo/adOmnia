import { Bug } from 'lucide-react'
import { useDevSessionStore } from '@/stores/devSession'

/** Debug Request, next to Send: offered once Go services are part of the workflow. */
export function DebugRequestButton({ url, onDebug }: { url: string; onDebug: () => void }) {
  const visible = useDevSessionStore((state) => state.order.length > 0 || Object.keys(state.prefs.knownServices).length > 0 || /\{\{\s*service:/.test(url))
  if (!visible) return null
  return (
    <button
      type="button"
      onClick={onDebug}
      disabled={!url}
      title="Debug Request: run the Go service under Delve, send this request and stop at its breakpoints"
      aria-label="Debug Request"
      className="flex h-[var(--ui-control-h)] items-center justify-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11px] font-semibold text-text-2 transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Bug size={14} aria-hidden="true" />
      Debug
    </button>
  )
}
