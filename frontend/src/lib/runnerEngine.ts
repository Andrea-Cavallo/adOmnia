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
  /** Max requests to fire concurrently per batch. 1 = sequential (default). */
  maxParallel?: number
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

/**
 * Execute a single request with retries and return its result + any variable
 * mutations emitted by post-scripts. Never throws — all errors are captured
 * inside the returned result.
 */
async function runSingleRequest(
  request: RequestItem,
  mergedVars: Record<string, string>,
  config: RunnerConfig,
  iter: number,
  datasetIndex: number,
  oaSpec?: string,
): Promise<{ result: RunnerRequestResult; mutations: Record<string, string | null> }> {
  let lastError = ''
  let response: ResponseData | null = null
  let scriptRuns: import('@/lib/types').ScriptRunResult[] = []
  let success = false
  const mutations: Record<string, string | null> = {}

  for (let attempt = 0; attempt <= config.retryCount && !success; attempt++) {
    try {
      if (attempt > 0 && config.delayMs > 0) await sleep(config.delayMs)
      const execution = await executeRequest(request, mergedVars)
      response = execution.response
      scriptRuns = execution.scriptRuns
      Object.assign(mutations, execution.mutations)
      if (response.error) {
        lastError = response.error.message || response.error.code
      } else {
        success = true
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }

  const assertions = response ? evaluateAssertions(request.assertions, response) : undefined
  const contract = (response && oaSpec && request._openapiPath)
    ? validateContract(oaSpec, request._openapiPath, request.method, response)
    : undefined
  const allAssertionsPassed = assertions ? assertions.every((a) => a.passed) : true
  const scriptsPassed = scriptRuns.every((run) => run.passed)
  const itemPassed = response ? !response.error && allAssertionsPassed && scriptsPassed : false

  const result: RunnerRequestResult = response
    ? {
        requestName: request.name,
        method: request.method,
        url: request.url,
        status: response.status,
        statusText: response.statusText,
        passed: itemPassed,
        durationMs: response.ms,
        size: response.size,
        iteration: iter,
        datasetIndex,
        body: response.body,
        contentType: response.contentType,
        headers: response.headers,
        error: response.error?.message || (!allAssertionsPassed ? 'Assertion failures' : !scriptsPassed ? 'Script failures' : undefined),
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
        datasetIndex,
        body: '',
        contentType: '',
        headers: {},
        error: lastError || 'Unknown error',
      }

  return { result, mutations }
}

export async function* runCollection(
  requests: RequestItem[],
  config: RunnerConfig,
  vars: Record<string, string>,
  oaSpec?: string,
): AsyncGenerator<RunnerProgress, RunnerSummary, void> {
  const parallel = Math.max(1, config.maxParallel ?? 1)
  const dataset = config.dataset && config.dataset.length > 0 ? config.dataset : [{}]
  const totalSteps = requests.length * config.iterations * dataset.length
  let step = 0
  const allResults: RunnerRequestResult[] = []
  let aborted = false
  const runnerVars = { ...vars }

  for (let iter = 1; iter <= config.iterations; iter++) {
    if (aborted) break

    for (let di = 0; di < dataset.length; di++) {
      if (aborted) break

      if (parallel <= 1) {
        // ── Sequential: variable mutations chain request-to-request ──
        for (const request of requests) {
          if (aborted) break
          const mergedVars = { ...runnerVars, ...(dataset[di] ?? {}) }
          const { result: itemResult, mutations } = await runSingleRequest(request, mergedVars, config, iter, di, oaSpec)
          for (const [key, value] of Object.entries(mutations)) {
            if (value === null) delete runnerVars[key]
            else runnerVars[key] = value
          }
          allResults.push(itemResult)
          step++
          yield { current: step, total: totalSteps, currentRequest: request.name, lastResult: itemResult, phase: 'running' }
          if (config.stopOnFailure && !itemResult.passed) aborted = true
          if (config.delayMs > 0 && !aborted) await sleep(config.delayMs)
        }
      } else {
        // ── Parallel batched: up to `parallel` requests fire concurrently ──
        // All requests in a batch share the same vars snapshot taken before the
        // batch starts. Mutations are applied back in request order after the
        // batch settles (last writer within a batch wins).
        const snapVars = { ...runnerVars, ...(dataset[di] ?? {}) }

        for (let bi = 0; bi < requests.length; bi += parallel) {
          if (aborted) break
          const batch = requests.slice(bi, bi + parallel)

          // Fire all requests in the batch at the same time
          const settled = await Promise.allSettled(
            batch.map((req) => runSingleRequest(req, snapVars, config, iter, di, oaSpec))
          )

          // Process results in request order so the log is deterministic
          for (let si = 0; si < settled.length; si++) {
            if (aborted) break
            const outcome = settled[si]
            const { result: itemResult, mutations } = outcome.status === 'fulfilled'
              ? outcome.value
              : {
                  result: {
                    requestName: batch[si].name,
                    method: batch[si].method,
                    url: batch[si].url,
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
                    error: String(outcome.reason) || 'Unknown error',
                  } as RunnerRequestResult,
                  mutations: {} as Record<string, string | null>,
                }

            // Apply mutations back to runnerVars so later batches can see them
            for (const [key, value] of Object.entries(mutations)) {
              if (value === null) delete runnerVars[key]
              else runnerVars[key] = value
            }

            allResults.push(itemResult)
            step++
            yield {
              current: step,
              total: totalSteps,
              currentRequest: itemResult.requestName,
              lastResult: itemResult,
              phase: 'running',
            }
            if (config.stopOnFailure && !itemResult.passed) aborted = true
          }

          // Inter-batch delay (same as inter-request delay in sequential mode)
          if (config.delayMs > 0 && !aborted) await sleep(config.delayMs)
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
  const rows = parseCsvRows(text)
  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).map((values) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = values[i] ?? '' })
    return row
  })
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let i = 0
  while (i < text.length) {
    const { row, next } = parseCsvLine(text, i)
    if (row.length > 0 || rows.length > 0) rows.push(row)
    i = next
  }
  return rows
}

function parseCsvLine(text: string, start: number): { row: string[]; next: number } {
  const fields: string[] = []
  let i = start
  while (i < text.length) {
    if (text[i] === '\r' || text[i] === '\n') {
      i++
      if (text[i - 1] === '\r' && text[i] === '\n') i++
      break
    }
    if (text[i] === '"') {
      i++
      let val = ''
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            val += '"'
            i += 2
          } else {
            i++
            break
          }
        } else {
          val += text[i]
          i++
        }
      }
      fields.push(val)
      if (text[i] === ',') i++
    } else {
      let val = ''
      while (i < text.length && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
        val += text[i]
        i++
      }
      fields.push(val.trim())
      if (text[i] === ',') i++
    }
  }
  return { row: fields, next: i }
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
