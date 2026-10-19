import type { Snapshot } from '../../bindings/adomnia/internal/resources/models'

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

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
    if (sample.budget.released > 0) lines.push(`- **Released by the budget:** ${mib(sample.budget.released)}`)
  }
  lines.push('', '## Processes', '', '| PID | Name | Workspace | RAM | CPU | Note |', '| --- | --- | --- | --- | --- | --- |')
  const ordered = [...sample.processes].sort((left, right) => right.ram - left.ram)
  for (const p of ordered) lines.push(`| ${p.pid} | ${cell(p.name)} | ${cell(p.workspace || '')} | ${p.error ? '—' : mib(p.ram)} | ${p.cpu == null ? '—' : `${p.cpu.toFixed(1)}%`} | ${cell(p.error ?? '')} |`)
  if (history.length > 1) {
    lines.push('', `## Last ${history.length} samples`, '', '| Time | RAM | CPU | Servers |', '| --- | --- | --- | --- |')
    for (const item of history) lines.push(`| ${item.at} | ${mib(item.ram)} | ${item.processes.some((p) => p.cpu != null) ? `${item.cpu.toFixed(1)}%` : '—'} | ${item.instances} |`)
  }
  lines.push('')
  return lines.join('\n')
}
