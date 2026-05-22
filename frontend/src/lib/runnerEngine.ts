import type { RequestItem, ResponseData, AssertionResult, ContractValidationResult } from '@/lib/types'
import { executeRequest } from '@/lib/executeRequest'
import { evaluateAssertions } from '@/lib/assertionEngine'
import { validateContract } from '@/lib/contractValidator'

export interface RunnerConfig {
  iterations: number
  delayMs: number
  stopOnFailure: boolean
  retryCount: number
  dataset?: Record<string, string>[]
}

export interface RunnerRequestResult {
  requestName: string
  method: string
  url: string
  status: number
  statusText: string
  passed: boolean
  durationMs: number
  size: number
  iteration: number
  datasetIndex: number
  body: string
  contentType: string
  headers: Record<string, string>
  error?: string
  assertionResults?: AssertionResult[]
  contractResult?: ContractValidationResult
  scriptRuns?: import('@/lib/types').ScriptRunResult[]
}

export interface RunnerSummary {
  totalRequests: number
  passed: number
  failed: number
  totalDurationMs: number
  avgMs: number
  minMs: number
  maxMs: number
  items: RunnerRequestResult[]
}

export interface RunnerProgress {
  current: number
  total: number
  currentRequest: string
  lastResult?: RunnerRequestResult
  phase: 'running' | 'done' | 'error'
}

export async function* runCollection(
  requests: RequestItem[],
  config: RunnerConfig,
  vars: Record<string, string>,
  oaSpec?: string,
): AsyncGenerator<RunnerProgress, RunnerSummary, void> {
  const totalSteps = requests.length * config.iterations
  let step = 0
  const allResults: RunnerRequestResult[] = []
  let aborted = false
  const runnerVars = { ...vars }

  const dataset = config.dataset && config.dataset.length > 0
    ? config.dataset
    : [{}]

  for (let iter = 1; iter <= config.iterations; iter++) {
    if (aborted) break

    for (let di = 0; di < dataset.length; di++) {
      if (aborted) break

      for (const request of requests) {
        if (aborted) break

        const mergedVars = { ...runnerVars, ...(dataset[di] ?? {}) }

        let lastError = ''
        let result: ResponseData | null = null
        let scriptRuns: import('@/lib/types').ScriptRunResult[] = []
        let success = false

        for (let attempt = 0; attempt <= config.retryCount && !success; attempt++) {
          try {
            if (attempt > 0 && config.delayMs > 0) {
              await sleep(config.delayMs)
            }

            const execution = await executeRequest(request, mergedVars)
            result = execution.response
            scriptRuns = execution.scriptRuns
            for (const [key, value] of Object.entries(execution.mutations)) {
              if (value === null) delete runnerVars[key]
              else runnerVars[key] = value
            }

            if (result.error) {
              lastError = result.error.message || result.error.code
              if (config.stopOnFailure) break
            } else {
              success = true
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e)
            if (config.stopOnFailure) break
          }
        }

        const assertions = result ? evaluateAssertions(request.assertions, result) : undefined
        const contract = (result && oaSpec && request._openapiPath) ? validateContract(oaSpec, request._openapiPath, request.method, result) : undefined
        const allAssertionsPassed = assertions ? assertions.every((a) => a.passed) : true
        const scriptsPassed = scriptRuns.every((run) => run.passed)
        const itemPassed = result ? !result.error && allAssertionsPassed && scriptsPassed : false

        const itemResult: RunnerRequestResult = result
          ? {
              requestName: request.name,
              method: request.method,
              url: request.url,
              status: result.status,
              statusText: result.statusText,
              passed: itemPassed,
              durationMs: result.ms,
              size: result.size,
              iteration: iter,
              datasetIndex: di,
              body: result.body,
              contentType: result.contentType,
              headers: result.headers,
              error: result.error?.message || (!allAssertionsPassed ? 'Assertion failures' : !scriptsPassed ? 'Script failures' : undefined),
              assertionResults: assertions,
              contractResult: contract,
              scriptRuns,
            }
          : {
              requestName: request.name,
              method: request.method,
              url: request.url,
              status: 0,
              statusText: 'Error',
              passed: false,
              durationMs: 0,
              size: 0,
              iteration: iter,
              datasetIndex: di,
              body: '',
              contentType: '',
              headers: {},
              error: lastError || 'Unknown error',
            }

        if (config.stopOnFailure && !itemResult.passed) {
          aborted = true
        }

        allResults.push(itemResult)
        step++

        const progress: RunnerProgress = {
          current: step,
          total: totalSteps,
          currentRequest: request.name,
          lastResult: itemResult,
          phase: 'running',
        }

        yield progress

        if (config.delayMs > 0 && !aborted) {
          await sleep(config.delayMs)
        }
      }
    }
  }

  const passed = allResults.filter((r) => r.passed).length
  const msList = allResults.filter((r) => r.durationMs > 0).map((r) => r.durationMs)

  return {
    totalRequests: allResults.length,
    passed,
    failed: allResults.length - passed,
    totalDurationMs: allResults.reduce((s, r) => s + r.durationMs, 0),
    avgMs: msList.length ? Math.round(msList.reduce((a, b) => a + b, 0) / msList.length) : 0,
    minMs: msList.length ? Math.min(...msList) : 0,
    maxMs: msList.length ? Math.max(...msList) : 0,
    items: allResults,
  }
}

export function parseCsvDataset(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"(.*)"$/, '$1'))
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1'))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

export function parseJsonDataset(text: string): Record<string, string>[] {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => {
        const row: Record<string, string> = {}
        for (const [k, v] of Object.entries(item)) {
          row[k] = v !== null && v !== undefined ? String(v) : ''
        }
        return row
      })
    }
    return []
  } catch {
    return []
  }
}

export function flattenRequests(
  node: import('@/lib/types').TreeNode,
): import('@/lib/types').RequestItem[] {
  if (node.type === 'request') return [node]
  if (node.type === 'folder') {
    return node.children.flatMap((c) => flattenRequests(c))
  }
  return []
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function exportRunnerReportMarkdown(summary: RunnerSummary): string {
  const lines: string[] = [
    '# Collection Run Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Requests | ${summary.totalRequests} |`,
    `| Passed | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
    `| Total Duration | ${summary.totalDurationMs} ms |`,
    `| Avg Response | ${summary.avgMs} ms |`,
    `| Min Response | ${summary.minMs} ms |`,
    `| Max Response | ${summary.maxMs} ms |`,
    '',
    '## Request Details',
    '',
    '| # | Request | Method | Status | Duration | Pass/Fail |',
    '|---|---------|--------|--------|----------|-----------|',
  ]

  summary.items.forEach((r, i) => {
    const icon = r.passed ? '✅' : '❌'
    const status = r.status || 'ERR'
    lines.push(`| ${i + 1} | ${r.requestName} | ${r.method} | ${status} | ${r.durationMs}ms | ${icon} ${r.passed ? 'Pass' : 'Fail'} |`)
  })

  return lines.join('\n')
}

export function exportRunnerReportHtml(summary: RunnerSummary): string {
  const pct = summary.totalRequests > 0
    ? Math.round((summary.passed / summary.totalRequests) * 100)
    : 0

  const rows = summary.items.map((r, i) => {
    const cls = r.passed ? 'pass' : 'fail'
    return `<tr class="${cls}"><td>${i + 1}</td><td>${r.requestName}</td><td class="mono">${r.method}</td><td>${r.status || 'ERR'}</td><td class="mono">${r.durationMs}ms</td><td>${r.passed ? 'PASS' : 'FAIL'}</td></tr>`
  }).join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Collection Run Report</title>
<style>body{font-family:system-ui;background:#1e1e2e;color:#cdd6f4;padding:20px;max-width:960px;margin:0 auto}
h1{color:#cdd6f4}h2{color:#a6adc8;font-size:16px;margin-top:24px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #313244;padding:6px 10px;text-align:left;font-size:13px}th{background:#313244;color:#a6adc8}
.mono{font-family:ui-monospace,monospace}.pass{color:#a6e3a1}.fail{color:#f38ba8}
.badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:bold;margin-right:8px}
.badge-pass{background:#a6e3a120;color:#a6e3a1}.badge-fail{background:#f38ba820;color:#f38ba8}
.summary{display:flex;gap:16px;margin:16px 0;flex-wrap:wrap}
.summary-item{background:#1e1e2e;border:1px solid #313244;border-radius:6px;padding:12px 16px;min-width:120px}
.summary-item .value{font-size:24px;font-weight:bold}.summary-item .label{font-size:11px;color:#a6adc8;text-transform:uppercase}</style></head><body>
<h1>Collection Run Report</h1>
<div class="summary">
<div class="summary-item"><span class="label">Pass Rate</span><br><span class="value" style="color:#a6e3a1">${pct}%</span></div>
<div class="summary-item"><span class="label">Total</span><br><span class="value">${summary.totalRequests}</span></div>
<div class="summary-item"><span class="label">Passed</span><br><span class="value" style="color:#a6e3a1">${summary.passed}</span></div>
<div class="summary-item"><span class="label">Failed</span><br><span class="value" style="color:#f38ba8">${summary.failed}</span></div>
<div class="summary-item"><span class="label">Avg</span><br><span class="value">${summary.avgMs}<small>ms</small></span></div>
</div>
<h2>Request Details</h2>
<table><thead><tr><th>#</th><th>Request</th><th>Method</th><th>Status</th><th>Duration</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`
}

export function exportRunnerReportJson(summary: RunnerSummary): string {
  return JSON.stringify({ report: 'collection-run', summary, timestamp: new Date().toISOString() }, null, 2)
}

export function exportRunnerReportJunit(summary: RunnerSummary): string {
  const suiteName = 'Collection Runner'
  const tests = summary.totalRequests
  const failures = summary.failed
  const time = (summary.totalDurationMs / 1000).toFixed(3)

  const cases = summary.items.map((r) => {
    const name = `[${r.method}] ${r.requestName} (iter ${r.iteration})`
    const timeMs = (r.durationMs / 1000).toFixed(3)
    if (r.passed) {
      return `    <testcase name="${xmlEscape(name)}" classname="${suiteName}" time="${timeMs}" />`
    }
    return `    <testcase name="${xmlEscape(name)}" classname="${suiteName}" time="${timeMs}">\n      <failure message="${xmlEscape(r.error || `Status ${r.status}`)}" />\n    </testcase>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${suiteName}" tests="${tests}" failures="${failures}" time="${time}">\n${cases}\n</testsuite>`
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
