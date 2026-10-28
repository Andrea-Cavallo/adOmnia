import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { resourceStats } from './resourceReport'

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`
const cell = (value: string) => value.replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ')

/** Application resources come Markdown da studiare: totali, budget, un processo per riga e l'andamento dei campioni recenti. */
export function resourcesToMarkdown(sample: Snapshot, history: Snapshot[] = []): string {
  const lines = [
    '# Application resources', '',
    `Sampled at ${sample.at}`, '',
    `- **RAM:** ${mib(sample.ram)}`,
    `- **CPU:** ${sample.processes.some((p) => p.cpu != null) ? `${sample.cpu.toFixed(1)}% (all logical cores)` : 'not measured yet'}`,
    `- **Servers:** ${sample.instances}`,
    `- **Processes:** ${sample.processes.length}`,
  ]
  if (sample.budget) {
    lines.push(`- **Memory target:** ${mib(sample.budget.target)}${sample.budget.pressure ? ' (memory pressure)' : ''}`)
    if (sample.budget.released > 0) lines.push(`- **Resources released by the budget:** ${sample.budget.released} (count, not bytes)`)
  }
  const stats = resourceStats(history)
  if (sample.runtime) lines.push(`- **Backend GOMEMLIMIT:** ${sample.runtime.memoryLimit > 1e15 ? 'startup default / unlimited' : mib(sample.runtime.memoryLimit)} (soft GC budget; not an RSS cap)`, `- **Backend heap:** ${mib(sample.runtime.heapAlloc)}; GC cycles: ${sample.runtime.numGC}; lifetime GC CPU fraction: ${(sample.runtime.gcCpuFraction*100).toFixed(2)}%`)
  lines.push(`- **Recording:** ${stats.samples} samples over ${stats.durationSeconds.toFixed(1)} s; CPU average ${stats.cpuAverage?.toFixed(2) ?? 'unavailable'}%; peak ${stats.cpuPeak?.toFixed(2) ?? 'unavailable'}%`, `- **Coverage:** ${sample.incomplete ? 'INCOMPLETE' : 'bounded OS snapshot'}; root PID ${sample.rootPid ?? 'unknown'}; ${sample.logicalCores ?? 'unknown'} logical cores.`, '', 'RSS is measured in bytes and displayed in MiB. Shared pages may be counted more than once. Null CPU is unavailable, not zero. Parent PID is an OS observation; only managed-session ownership is registered by Code Studio. Raw commands and environment are omitted. Export JSON or CSV for all historical per-process samples.', ...(sample.warnings ?? []).map(w => `- Warning: ${w}`))
  lines.push('', '## Processes', '', '| PID | Name | Workspace | RAM | CPU | Parent | Role / owner | GOMEMLIMIT | Executable / identity / note |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  const ordered = [...sample.processes].sort((left, right) => right.ram - left.ram)
  for (const p of ordered) lines.push(`| ${p.pid} | ${cell(p.name)} | ${cell(p.workspace || '')} | ${p.error ? '—' : mib(p.ram)} | ${p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`} | ${p.parentPid ?? '?'} ${cell(p.parentName ?? '')} | ${cell([p.role,p.owner,p.sessionId,p.attribution].filter(Boolean).join(' / '))} | ${cell(p.memoryLimit ?? '')} | ${cell([p.executable, p.createdAt, p.error].filter(Boolean).join(' · '))} |`)
  if (history.length > 1) {
    lines.push('', `## Last ${history.length} samples`, '', '| Time | RAM | CPU | Servers |', '| --- | --- | --- | --- |')
    for (const item of history) lines.push(`| ${item.at} | ${mib(item.ram)} | ${item.processes.some((p) => p.cpu != null) ? `${item.cpu.toFixed(1)}%` : '—'} | ${item.instances} |`)
  }
  lines.push('')
  return lines.join('\n')
}
