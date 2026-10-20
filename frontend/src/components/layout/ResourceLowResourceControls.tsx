import { Gauge, Loader2 } from 'lucide-react'
import { useCodeStudioLowResources } from '@/stores/codeStudioLowResources'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useUiTranslation } from '@/lib/uiI18n'

export function ResourceLowResourceControls() {
  const tr = useUiTranslation()
  const busy = useCodeStudioLowResources(state => state.busy)
  const restore = useCodeStudioLowResources(state => state.restore)
  const error = useCodeStudioLowResources(state => state.error)
  const mode = useCodeStudioLspStore(state => state.preferences.resourceMode)
  const active = !!restore || mode === 'low'
  return <section className="my-3 space-y-2 border-y border-border-1 py-3">
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 font-medium"><Gauge size={14} aria-hidden="true" />{tr('Low resources')}</span>
      <button type="button" disabled={busy} aria-pressed={active} onClick={() => void useCodeStudioLowResources.getState().toggle()} className={`flex min-h-8 items-center gap-2 rounded border px-3 py-1 disabled:opacity-50 ${active ? 'border-accent text-accent' : 'border-border-2 text-text-2 hover:bg-surface-2'}`}>
        {busy && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
        {tr(busy ? 'Applying…' : error && restore ? 'Retry restore' : active ? 'Restore services' : 'Enable low resources')}
      </button>
    </div>
    <p className="text-text-3">{tr('Pause AI assistants and optional analyses. Completion, navigation, diagnostics, Run and Debug stay available.')}</p>
    <p className="text-text-4">{tr('Click again to restore the services that were enabled before. No application restart needed.')}</p>
    {error && <p role="alert" className="break-words text-warning">{error}</p>}
  </section>
}
