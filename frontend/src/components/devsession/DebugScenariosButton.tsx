import { lazy, Suspense, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clapperboard } from 'lucide-react'
import type { RequestItem } from '@/lib/types'
import { useDebugScenariosStore } from '@/stores/debugScenarios'
import { useDevSessionStore } from '@/stores/devSession'

const DebugScenariosDialog = lazy(() => import('./DebugScenariosDialog').then((module) => ({ default: module.DebugScenariosDialog })))

/** Debug scenarios, next to Debug Request: save this request as a replayable scenario, or run one. */
export function DebugScenariosButton({ tabId, request }: { tabId: string; request: RequestItem }) {
  const [open, setOpen] = useState(false)
  const count = useDebugScenariosStore((state) => state.scenarios.filter((item) => item.request.id === request.id).length)
  const visible = useDevSessionStore((state) => state.order.length > 0 || Object.keys(state.prefs.knownServices).length > 0 || /\{\{\s*service:/.test(request.url)) || count > 0
  if (!visible) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Debug scenarios: save request, environment, test data, breakpoints, assertions and queries, replay them with one click and see what changed"
        aria-label="Debug scenarios"
        className="flex h-[var(--ui-control-h)] items-center justify-center gap-1.5 rounded-md border border-border-2 px-2.5 text-[11px] font-semibold text-text-2 transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent"
      >
        <Clapperboard size={14} aria-hidden="true" />
        Scenarios{count > 0 ? ` · ${count}` : ''}
      </button>
      {open && createPortal(
        // The button lives in the request actions menu, which closes and refocuses on any click:
        // React bubbles portal events through it, so they stop here.
        <div role="presentation" onClick={(event) => event.stopPropagation()}>
          <Suspense fallback={null}>
            <DebugScenariosDialog open onClose={() => setOpen(false)} tabId={tabId} request={request} />
          </Suspense>
        </div>,
        document.body,
      )}
    </>
  )
}
