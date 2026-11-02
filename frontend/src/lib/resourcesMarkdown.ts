import type { Snapshot } from '../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/resources/models'
import { resourceReport, type ReportEnvironment } from './resourceReport'

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MiB`
const cell = (value: string | number | null | undefined) => String(value ?? '').replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ')
const percent = (value: number | null | undefined) => (value == null ? '—' : `${value.toFixed(2)}%`)

/**
 * Application resources as Markdown to study: environment and window quality
 * first, then one row per process identity for the whole recording, then the
 * samples with the silences the charts break on.
 */
export function resourcesToMarkdown(sample: Snapshot, history: Snapshot[] = [], scenario = 'Observation', environment: ReportEnvironment | null = null): string {
  const report = resourceReport(sample, history, scenario, environment)
  const latest = report.samples[report.samples.length - 1]
  const environmentLine = [
    report.environment.appVersion && `adOmnia ${report.environment.appVersion}`,
    report.environment.gitCommit && `commit ${report.environment.gitCommit}`,
    report.environment.osVersion ?? report.environment.os,
    report.environment.arch,
    report.environment.logicalCores != null && `${report.environment.logicalCores} logical cores`,
    report.environment.totalRamBytes != null && `${(report.environment.totalRamBytes / 1073741824).toFixed(1)} GiB physical RAM`,
    report.environment.memoryBudgetTarget != null && `budget ${mib(report.environment.memoryBudgetTarget)} (${report.environment.memoryBudgetSource})`,
    report.environment.goVersion,
  ].filter(Boolean).join(' · ')
  const lines = [
    '# Application resources', '',
    `**Scenario:** ${cell(report.scenario)} — exported ${report.exportedAt} (schemaVersion ${report.schemaVersion})`, '',
    `- **Machine / build:** ${environmentLine}`,
    `- **Window:** ${report.quality.samples} samples over ${report.quality.durationSeconds.toFixed(1)} s · median interval ${report.quality.medianIntervalSeconds ?? '—'} s · ${report.quality.gaps} gaps · ${report.quality.sufficient ? 'sufficient for an average' : '**insufficient for an average**'}`,
    `- **CPU:** average ${percent(report.summary.cpuAverage)}${report.summary.cpuAverageCores != null ? ` (${report.summary.cpuAverageCores} of ${report.environment.logicalCores} cores)` : ''}, peak ${percent(report.summary.cpuPeak)}; time-weighted over the measured intervals`,
    `- **RAM:** latest ${latest ? mib(latest.ram) : '—'}, peak ${report.summary.ramPeak == null ? '—' : mib(report.summary.ramPeak)}`,
    `- **Servers:** ${latest?.instances ?? 0} language servers`,
  ]
  if (latest?.budget) lines.push(`- **Memory target:** ${mib(latest.budget.target)}${latest.budget.pressure ? ' (memory pressure)' : ''}`)
  if (latest?.budget && latest.budget.released > 0) lines.push(`- **Resources released by the budget:** ${latest.budget.released} (count, not bytes)`)
  if (latest?.runtime) lines.push(`- **Backend GOMEMLIMIT:** ${latest.runtime.memoryLimit > 1e15 ? 'startup default / unlimited' : mib(latest.runtime.memoryLimit)} (soft GC budget; not an RSS cap)`, `- **Backend heap:** ${mib(latest.runtime.heapAlloc)}; GC cycles: ${latest.runtime.numGC}; lifetime GC CPU fraction: ${(latest.runtime.gcCpuFraction * 100).toFixed(2)}%`)
  for (const caveat of report.quality.caveats) lines.push(`- **Caveat:** ${cell(caveat)}`)
  lines.push('', 'CPU percent is the share of total logical capacity. RSS is summed process memory in bytes, displayed in MiB; shared pages may be counted more than once. Null CPU is unavailable, not zero. Parent PID is an OS observation; only managed-session ownership is registered by Code Studio. Raw commands and environment are omitted. Export JSON or CSV for every historical per-sample value.', '')

  lines.push('## Processes', '', '| Process | PID | Parent | Role | Owner | Workspace | Samples | Peak RAM | Avg CPU | Peak CPU |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const process of report.processes) {
    lines.push(`| ${cell(process.name)} | ${process.pid} | ${process.parentPid} ${cell(process.parentName)} | ${cell(process.role)} | ${cell(process.owner)} | ${cell(process.workspace)} | ${process.samples} | ${mib(process.ramPeakBytes)} | ${percent(process.cpuAverage)} | ${percent(process.cpuPeak)} |`)
  }

  if (report.samples.length > 1) {
    lines.push('', '## Samples', '', '| Time | Interval | Gap | RAM | CPU |', '| --- | --- | --- | --- | --- |')
    for (const item of report.samples) {
      lines.push(`| ${item.at} | ${item.intervalSeconds ?? '—'} s | ${item.gapSeconds ? `**${item.gapSeconds} s not sampled**` : ''} | ${mib(item.ram)} | ${percent(item.cpu)} |`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
