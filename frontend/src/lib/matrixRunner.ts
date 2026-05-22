import type { RequestItem, ResponseData } from '@/lib/types'
import { executeRequest } from '@/lib/executeRequest'

export interface MatrixEnv {
  id: string
  name: string
  vars: Record<string, string>
}

export interface MatrixResult {
  envId: string
  envName: string
  response: ResponseData | null
  error?: string
  durationMs: number
}

export function diffResults(
  results: MatrixResult[],
  excludeFields?: string[],
): { field: string; values: { envName: string; value: string }[] }[] {
  const diffs: { field: string; values: { envName: string; value: string }[] }[] = []
  const excluded = new Set(excludeFields ?? [])

  // Status code diff
  if (!excluded.has('status')) {
    const statusValues = results
      .filter((r) => r.response && !r.response.error)
      .map((r) => ({
        envName: r.envName,
        value: `${r.response!.status} ${r.response!.statusText}`,
      }))
    if (new Set(statusValues.map((v) => v.value)).size > 1) {
      diffs.push({ field: 'Status', values: statusValues })
    }
  }

  // Time diff
  if (!excluded.has('time')) {
    const timeValues = results
      .filter((r) => !r.error)
      .map((r) => ({
        envName: r.envName,
        value: `${r.durationMs}ms`,
      }))
    if (new Set(timeValues.map((v) => v.value)).size > 1) {
      diffs.push({ field: 'Response Time', values: timeValues })
    }
  }

  // Body diff
  if (!excluded.has('body')) {
    const bodyValues = results
      .filter((r) => r.response && !r.response.error && r.response.body)
      .map((r) => ({
        envName: r.envName,
        value: `${r.response!.body.length}B`,
      }))
    if (new Set(bodyValues.map((v) => v.value)).size > 1) {
      diffs.push({ field: 'Body Size', values: bodyValues })
    }
  }

  return diffs
}

export async function* runMatrix(
  request: RequestItem,
  environments: MatrixEnv[],
): AsyncGenerator<{ current: number; total: number; lastResult?: MatrixResult }, MatrixResult[], void> {
  const results: MatrixResult[] = []
  const total = environments.length

  for (let i = 0; i < environments.length; i++) {
    const env = environments[i]
    const t0 = performance.now()
    let result: MatrixResult

    try {
      const execution = await executeRequest(request, { ...env.vars })
      const response = execution.response
      result = {
        envId: env.id,
        envName: env.name,
        response: response,
        durationMs: Math.round(performance.now() - t0),
      }
    } catch (e) {
      result = {
        envId: env.id,
        envName: env.name,
        response: null,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Math.round(performance.now() - t0),
      }
    }

    results.push(result)
    yield { current: i + 1, total, lastResult: result }
  }

  return results
}

export function exportMatrixReportMarkdown(results: MatrixResult[], requestName: string): string {
  const lines: string[] = [
    `# Environment Matrix Report`,
    `**Request:** ${requestName}`,
    '',
    '| Environment | Status | Time | Size |',
    '|-------------|--------|------|------|',
  ]

  for (const r of results) {
    if (r.error) {
      lines.push(`| ${r.envName} | ERROR | - | - |`)
      lines.push(`| | ${r.error} | | |`)
    } else if (r.response) {
      const status = r.response.error
        ? `ERR: ${r.response.error.code}`
        : `${r.response.status} ${r.response.statusText}`
      lines.push(`| ${r.envName} | ${status} | ${r.durationMs}ms | ${r.response.size}B |`)
    }
  }

  lines.push('')
  const diffs = diffResults(results)
  if (diffs.length > 0) {
    lines.push('## Differences')
    for (const d of diffs) {
      lines.push(`- **${d.field}**: ${d.values.map((v) => `${v.envName}=${v.value}`).join(', ')}`)
    }
  } else {
    lines.push('No differences detected across environments.')
  }

  return lines.join('\n')
}

export function exportMatrixReportHtml(results: MatrixResult[], requestName: string): string {
  const rows = results.map((r) => {
    if (r.error) return `<tr><td>${r.envName}</td><td class="fail">ERROR</td><td>-</td><td>-</td></tr>`
    if (r.response?.error) return `<tr><td>${r.envName}</td><td class="fail">${r.response.error.code}</td><td>${r.durationMs}ms</td><td>-</td></tr>`
    const status = `${r.response?.status ?? '?'} ${r.response?.statusText ?? ''}`
    const cls = (r.response?.status ?? 0) >= 400 ? 'fail' : 'pass'
    return `<tr><td>${r.envName}</td><td class="${cls}">${status}</td><td>${r.durationMs}ms</td><td>${r.response?.size ?? 0}B</td></tr>`
  }).join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Matrix Report</title><style>body{font-family:system-ui;background:#1e1e2e;color:#cdd6f4;padding:20px;max-width:800px;margin:0 auto}table{border-collapse:collapse;width:100%}th,td{border:1px solid #313244;padding:6px 10px;text-align:left;font-size:13px}th{background:#313244}.pass{color:#a6e3a1}.fail{color:#f38ba8}</style></head><body><h1>Environment Matrix Report</h1><p>Request: ${requestName}</p><table><thead><tr><th>Environment</th><th>Status</th><th>Time</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table></body></html>`
}

export function exportMatrixReportJson(results: MatrixResult[], requestName: string): string {
  return JSON.stringify({ report: 'environment-matrix', requestName, results, timestamp: new Date().toISOString() }, null, 2)
}

export interface MatrixConfig {
  envIds: string[]
  excludeFields: string[]
}

const MATRIX_CONFIG_KEY = 'adomnia.matrix.config'

export function saveMatrixConfig(config: MatrixConfig): void {
  try { localStorage.setItem(MATRIX_CONFIG_KEY, JSON.stringify(config)) } catch { /* */ }
}

export function loadMatrixConfig(): MatrixConfig | null {
  try {
    const raw = localStorage.getItem(MATRIX_CONFIG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
