import type { GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
import { safeSetItem } from '@/lib/safeLocalStorage'

const STORAGE_PREFIX = 'adomnia.goide.quality-history.v1.'
const MAX_SAMPLES = 60

/** Esito di una run completa del linter: la serie forma il trend del debito tecnico. */
export interface GoStudioLintSample {
  at: string
  linter: string
  issues: number
  baselined: number
}

function storageKey(projectRoot: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectRoot.trim())}`
}

export function loadLintSamples(projectRoot: string): GoStudioLintSample[] {
  if (!projectRoot.trim()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(projectRoot)) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is GoStudioLintSample => typeof item?.at === 'string' && typeof item?.issues === 'number' && typeof item?.baselined === 'number').slice(-MAX_SAMPLES)
      : []
  } catch {
    return []
  }
}

/** Aggiunge un campione; due run identiche e ravvicinate (lint on save) non duplicano il punto. */
export function recordLintSample(projectRoot: string, sample: GoStudioLintSample): GoStudioLintSample[] {
  if (!projectRoot.trim()) return []
  const samples = loadLintSamples(projectRoot)
  const last = samples[samples.length - 1]
  const sameAsLast = last && last.issues === sample.issues && last.baselined === sample.baselined && last.linter === sample.linter
    && Date.parse(sample.at) - Date.parse(last.at) < 60 * 60 * 1000
  const next = sameAsLast ? samples : [...samples, sample].slice(-MAX_SAMPLES)
  if (!sameAsLast) safeSetItem(storageKey(projectRoot), JSON.stringify(next))
  return next
}

export interface GoStudioDebtTrend {
  current: number
  first: number
  delta: number
  direction: 'better' | 'worse' | 'flat'
}

/** Debito = problemi visibili + quelli accettati in baseline: nascondere non lo riduce. */
export function debtTrend(samples: readonly GoStudioLintSample[]): GoStudioDebtTrend | null {
  if (samples.length === 0) return null
  const total = (sample: GoStudioLintSample) => sample.issues + sample.baselined
  const first = total(samples[0])
  const current = total(samples[samples.length - 1])
  const delta = current - first
  return { current, first, delta, direction: delta < 0 ? 'better' : delta > 0 ? 'worse' : 'flat' }
}

export interface GoStudioQualityBreakdown {
  bySource: { name: string; count: number }[]
  byFile: { relativePath: string; count: number }[]
}

/** I linter e i file con più problemi, per sapere da dove iniziare. */
export function qualityBreakdown(reports: readonly GoIDEDiagnosticsReport[], limit = 8): GoStudioQualityBreakdown {
  const sources = new Map<string, number>()
  const files: { relativePath: string; count: number }[] = []
  for (const report of reports) {
    if (report.diagnostics.length === 0) continue
    files.push({ relativePath: report.relativePath ?? report.path, count: report.diagnostics.length })
    for (const diagnostic of report.diagnostics) {
      const name = diagnostic.code ? `${diagnostic.source || 'lint'} ${diagnostic.code}` : diagnostic.source || 'lint'
      sources.set(name, (sources.get(name) ?? 0) + 1)
    }
  }
  const byCount = <T extends { count: number }>(left: T, right: T) => right.count - left.count
  return {
    bySource: [...sources].map(([name, count]) => ({ name, count })).sort((left, right) => byCount(left, right) || left.name.localeCompare(right.name)).slice(0, limit),
    byFile: files.sort((left, right) => byCount(left, right) || left.relativePath.localeCompare(right.relativePath)).slice(0, limit),
  }
}
