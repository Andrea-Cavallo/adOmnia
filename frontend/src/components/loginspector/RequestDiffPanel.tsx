import { Copy, X } from 'lucide-react'
import { compareRequestPayloads, type AnalyzedRequest, type LogEvent } from '@/lib/loginspector'

function requestName(request: AnalyzedRequest): string {
  return request.correlationId || request.traceId || request.requestId
}

function display(value: unknown): string {
  if (value === undefined) return '— missing —'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function RequestDiffPanel({ events, left, right, onClose }: {
  events: LogEvent[]
  left: AnalyzedRequest
  right: AnalyzedRequest
  onClose: () => void
}) {
  const comparison = compareRequestPayloads(events, left, right)
  return (
    <div className="absolute inset-4 z-40 flex flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 shadow-[0_18px_60px_rgba(0,0,0,.65)]">
      <header className="flex items-center gap-3 border-b border-border-1 bg-surface-1 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-4">Request payload diff</p>
          <p className="truncate font-mono text-[11px] text-text-1">{requestName(left)} ↔ {requestName(right)}</p>
        </div>
        <span className="rounded bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-3">{comparison.differences.length} differences</span>
        <button onClick={onClose} title="Close comparison" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-error"><X size={13} /></button>
      </header>
      <p className="border-b border-border-1 px-3 py-1 text-[9px] text-text-4">
        Ignored volatile fields: {comparison.ignoredPaths.join(', ')}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {comparison.leftBody === null || comparison.rightBody === null ? (
          <p className="px-4 py-8 text-center text-xs text-warning">Both selected chains need an observed request body.</p>
        ) : comparison.differences.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-success">No payload difference after volatile-field exclusions.</p>
        ) : (
          <table className="w-full table-fixed border-collapse font-mono text-[10px]">
            <thead className="sticky top-0 bg-surface-1 text-left text-[9px] uppercase tracking-wider text-text-4">
              <tr><th className="w-[28%] px-3 py-1.5">JSONPath</th><th className="w-[34%] px-3 py-1.5">Left</th><th className="px-3 py-1.5">Right</th></tr>
            </thead>
            <tbody>
              {comparison.differences.map((difference) => (
                <tr key={difference.path} className="border-t border-border-1 hover:bg-surface-1">
                  <td className="group px-3 py-1.5 text-accent-light">
                    <span className="break-all">{difference.path}</span>
                    <button onClick={() => navigator.clipboard.writeText(difference.path).catch(() => {})} title="Copy JSONPath" className="ml-1 inline-grid h-5 w-5 place-items-center opacity-0 group-hover:opacity-100"><Copy size={10} /></button>
                  </td>
                  <td className="break-all px-3 py-1.5 text-error">{display(difference.left)}</td>
                  <td className="break-all px-3 py-1.5 text-success">{display(difference.right)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
