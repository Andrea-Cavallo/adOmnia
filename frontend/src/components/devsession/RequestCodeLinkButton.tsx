import { Code2 } from 'lucide-react'
import { routeToModule } from '@/lib/moduleRouting'
import { useEnvironmentsStore } from '@/stores/environments'
import { resolvedRequestUrl } from '@/lib/requestUrl'
import { substVars } from '@/lib/substVars'
import { liveVars } from '@/lib/devsession/liveRequest'
import { useUiTranslation } from '@/lib/uiI18n'
import type { RequestItem } from '@/lib/types'

/**
 * API → Code Studio: resolves the handler of this request only when the user
 * asks for it (no background project scans) and shows both sides side by side.
 */
export function RequestCodeLinkButton({ tabId, request }: { tabId: string; request: RequestItem }) {
  const tr = useUiTranslation()
  const open = () => {
    const vars = liveVars(useEnvironmentsStore.getState().getResolvedVars())
    const url = substVars(resolvedRequestUrl(request), vars)
    routeToModule('collections', { kind: 'api-code-request', requestTabId: tabId, method: request.method, url })
  }
  return (
    <button type="button" onClick={open} title={tr('Open in Code Studio')} aria-label={tr('Open in Code Studio')}
      className="flex h-[var(--ui-control-h)] shrink-0 items-center gap-1.5 rounded-md border border-border-2 px-2 text-[11px] text-text-3 transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent">
      <Code2 size={13} aria-hidden="true" />
      <span className="hidden xl:inline">Code</span>
    </button>
  )
}
