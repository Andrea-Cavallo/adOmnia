import type { GoIDEExecution } from '@/lib/code-studio-api'

export function CodeStudioExecutionDetails({ execution, search }: { execution: GoIDEExecution; search: string }) {
  const matches = Boolean(search) && `${execution.command}\n${execution.workingDirectory}`.toLowerCase().includes(search.toLowerCase())
  if (search && !matches) return null
  return <details key={execution.id} open={matches || undefined} className="mb-3 border-b border-border-1 pb-2 text-[12px] text-text-3">
    <summary className="cursor-pointer select-none font-sans">Execution details</summary>
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded border border-border-1 bg-surface-1 p-3">
      <dt className="font-sans">Command</dt><dd className="whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]">{execution.command}</dd>
      <dt className="font-sans">Directory</dt><dd className="text-text-2 [overflow-wrap:anywhere]">{execution.workingDirectory}</dd>
    </dl>
  </details>
}
