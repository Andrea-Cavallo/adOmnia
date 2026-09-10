import { Download, ShieldCheck, X } from 'lucide-react'
import { buildEvidenceBundle, serializeEvidence, type LogEvent, type LogFilterState } from '@/lib/loginspector'
import { downloadText } from '@/lib/fileUtils'

export function EvidencePreviewPanel({ events, filters, notes, maskFields, hiddenFields, onClose }: {
  events: LogEvent[]
  filters: LogFilterState
  notes: string
  maskFields: string[]
  hiddenFields: string[]
  onClose: () => void
}) {
  const bundle = buildEvidenceBundle(events, { filters, notes, extraSensitiveFields: maskFields, hiddenFields })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return (
    <div className="absolute inset-4 z-50 flex flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_18px_60px_rgba(0,0,0,.65)]">
      <header className="flex items-center gap-3 border-b border-border-1 bg-surface-1 px-3 py-2">
        <ShieldCheck size={14} className="text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Redacted evidence preview</p>
          <p className="text-[11px] text-text-2">{events.length} events · {bundle.sources.length} sources · secrets removed from raw, JSON and notes</p>
        </div>
        <button onClick={() => downloadText(`log-evidence-${stamp}.json`, serializeEvidence(bundle), 'application/json')} className="flex h-7 items-center gap-1 rounded border border-accent/40 px-2 text-[10px] text-accent-light hover:bg-accent/10"><Download size={11} /> Package</button>
        <button onClick={() => downloadText(`log-evidence-${stamp}.md`, bundle.summaryMarkdown, 'text/markdown')} className="flex h-7 items-center gap-1 rounded border border-border-2 px-2 text-[10px] text-text-2 hover:text-text-1"><Download size={11} /> Markdown</button>
        <button onClick={onClose} title="Close preview" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-error"><X size={13} /></button>
      </header>
      <div className="border-b border-border-1 bg-warning/5 px-3 py-1.5 text-[9px] text-text-4">
        UI-hidden fields are listed but retained. Redaction is irreversible in exported copies. Extra sensitive fields: {maskFields.join(', ') || 'built-in set'}.
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-text-2">{bundle.summaryMarkdown}</pre>
    </div>
  )
}
