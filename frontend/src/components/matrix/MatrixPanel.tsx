import { useMemo, useState } from 'react'
import { Download, FileCode, FileJson, FileText, GitBranch, Play, Plus, Save, Trash2, X } from 'lucide-react'
import type { Environment, HttpMethod, RequestItem, ResponseData, TreeNode } from '@/lib/types'
import { blankRequest, uid } from '@/lib/types'
import { executeRequest } from '@/lib/executeRequest'
import { useCollectionsStore } from '@/stores/collections'
import { useEnvironmentsStore } from '@/stores/environments'
import { cn } from '@/lib/utils'
import { loadMatrixConfig, saveMatrixConfig } from '@/lib/matrixRunner'

type MatrixMode = 'request' | 'collection' | 'flow'

interface FlowStep {
  id: string
  name: string
  request: RequestItem
}

interface MatrixEntry {
  envId: string
  envName: string
  itemName: string
  response: ResponseData | null
  durationMs: number
  error?: string
}

interface MatrixDiff {
  itemName: string
  field: string
  severity: 'normal' | 'critical'
  values: { envName: string; value: string }[]
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const DEFAULT_EXCLUDES = ['json:timestamp', 'json:id', 'json:requestId', 'header:date', 'header:x-request-id']

function flattenRequests(node: TreeNode): RequestItem[] {
  if (node.type === 'request') return [node]
  return node.children.flatMap(flattenRequests)
}

function envVars(env: Environment): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const item of env.variables ?? []) {
    if (item.enabled && item.key) vars[item.key] = item.value
  }
  return vars
}

function newFlowStep(index: number): FlowStep {
  const request = blankRequest('GET')
  return {
    id: uid(),
    name: `Step ${index}`,
    request: { ...request, name: `Step ${index}` },
  }
}

function flattenJson(prefix: string, value: unknown, out: Record<string, string>) {
  if (value == null) {
    out[prefix] = 'null'
    return
  }
  if (typeof value !== 'object') {
    out[prefix] = String(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJson(`${prefix}[${index}]`, item, out))
    return
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    flattenJson(prefix ? `${prefix}.${key}` : key, item, out)
  }
}

function parseJsonBody(body: string): Record<string, string> | null {
  try {
    const out: Record<string, string> = {}
    flattenJson('', JSON.parse(body), out)
    return out
  } catch {
    return null
  }
}

function parseXmlBody(body: string): Record<string, string> | null {
  try {
    const doc = new DOMParser().parseFromString(body, 'application/xml')
    if (doc.querySelector('parsererror')) return null
    const out: Record<string, string> = {}
    const visit = (el: Element, prefix: string) => {
      const name = el.localName || el.tagName
      const path = prefix ? `${prefix}.${name}` : name
      if (el.children.length === 0) {
        out[path] = el.textContent?.trim() ?? ''
        return
      }
      Array.from(el.children).forEach((child) => visit(child, path))
    }
    if (doc.documentElement) visit(doc.documentElement, '')
    return out
  } catch {
    return null
  }
}

function isExcluded(field: string, excludes: string[]) {
  const f = field.toLowerCase()
  return excludes.some((item) => {
    const normalized = item.trim().toLowerCase()
    return normalized && (f === normalized || f.startsWith(`${normalized}.`) || f.startsWith(`${normalized}[`))
  })
}

function valueChanged(values: { value: string }[]) {
  return new Set(values.map((v) => v.value)).size > 1
}

function buildDiffs(entries: MatrixEntry[], excludes: string[]): MatrixDiff[] {
  const diffs: MatrixDiff[] = []
  const itemNames = Array.from(new Set(entries.map((entry) => entry.itemName)))

  for (const itemName of itemNames) {
    const group = entries.filter((entry) => entry.itemName === itemName)
    const add = (field: string, severity: MatrixDiff['severity'], values: { envName: string; value: string }[]) => {
      if (!isExcluded(field, excludes) && values.length > 1 && valueChanged(values)) {
        diffs.push({ itemName, field, severity, values })
      }
    }

    add('status', 'critical', group.map((entry) => ({
      envName: entry.envName,
      value: entry.error || entry.response?.error?.message || `${entry.response?.status ?? 'ERR'} ${entry.response?.statusText ?? ''}`,
    })))
    add('time', 'normal', group.map((entry) => ({ envName: entry.envName, value: `${entry.durationMs}ms` })))
    add('size', 'normal', group.map((entry) => ({ envName: entry.envName, value: `${entry.response?.size ?? 0}B` })))

    const headerKeys = new Set<string>()
    group.forEach((entry) => Object.keys(entry.response?.headers ?? {}).forEach((key) => headerKeys.add(key.toLowerCase())))
    for (const key of headerKeys) {
      add(`header:${key}`, 'normal', group.map((entry) => {
        const found = Object.entries(entry.response?.headers ?? {}).find(([name]) => name.toLowerCase() === key)
        return { envName: entry.envName, value: found?.[1] ?? '(missing)' }
      }))
    }

    const jsonByEnv = group.map((entry) => ({ entry, fields: parseJsonBody(entry.response?.body ?? '') }))
    if (jsonByEnv.some((item) => item.fields)) {
      const keys = new Set<string>()
      jsonByEnv.forEach((item) => Object.keys(item.fields ?? {}).forEach((key) => keys.add(key)))
      for (const key of keys) {
        add(`json:${key}`, 'critical', jsonByEnv.map((item) => ({
          envName: item.entry.envName,
          value: item.fields?.[key] ?? '(missing)',
        })))
      }
    } else {
      const xmlByEnv = group.map((entry) => ({ entry, fields: parseXmlBody(entry.response?.body ?? '') }))
      if (xmlByEnv.some((item) => item.fields)) {
        const keys = new Set<string>()
        xmlByEnv.forEach((item) => Object.keys(item.fields ?? {}).forEach((key) => keys.add(key)))
        for (const key of keys) {
          add(`xml:${key}`, 'critical', xmlByEnv.map((item) => ({
            envName: item.entry.envName,
            value: item.fields?.[key] ?? '(missing)',
          })))
        }
      } else {
        add('body', 'critical', group.map((entry) => ({ envName: entry.envName, value: entry.response?.body ?? '' })))
      }
    }
  }
  return diffs
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown(entries: MatrixEntry[], diffs: MatrixDiff[], title: string) {
  const lines = [`# Environment Matrix Report`, '', `**Scope:** ${title}`, '', '| Item | Environment | Status | Time | Size |', '|---|---|---|---:|---:|']
  for (const entry of entries) {
    const status = entry.error || entry.response?.error?.message || `${entry.response?.status ?? 'ERR'} ${entry.response?.statusText ?? ''}`
    lines.push(`| ${entry.itemName} | ${entry.envName} | ${status} | ${entry.durationMs}ms | ${entry.response?.size ?? 0}B |`)
  }
  lines.push('', '## Differences')
  if (diffs.length === 0) lines.push('No differences detected.')
  for (const diff of diffs) {
    lines.push(`- **${diff.itemName} / ${diff.field}**: ${diff.values.map((v) => `${v.envName}=${v.value}`).join('; ')}`)
  }
  return lines.join('\n')
}

function exportHtml(entries: MatrixEntry[], diffs: MatrixDiff[], title: string) {
  const rows = entries.map((entry) => {
    const status = entry.error || entry.response?.error?.message || `${entry.response?.status ?? 'ERR'} ${entry.response?.statusText ?? ''}`
    const cls = entry.error || entry.response?.error || (entry.response?.status ?? 0) >= 400 ? 'bad' : 'ok'
    return `<tr><td>${escapeHtml(entry.itemName)}</td><td>${escapeHtml(entry.envName)}</td><td class="${cls}">${escapeHtml(status)}</td><td>${entry.durationMs}ms</td><td>${entry.response?.size ?? 0}B</td></tr>`
  }).join('')
  const diffRows = diffs.map((diff) => `<tr class="${diff.severity === 'critical' ? 'badrow' : ''}"><td>${escapeHtml(diff.itemName)}</td><td>${escapeHtml(diff.field)}</td><td>${escapeHtml(diff.values.map((v) => `${v.envName}: ${v.value}`).join(' | '))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Environment Matrix</title><style>body{font-family:system-ui;background:#111827;color:#d1d5db;padding:24px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #374151;padding:7px 10px;font-size:13px}th{background:#1f2937}.ok{color:#86efac}.bad{color:#fca5a5}.badrow{background:#7f1d1d33}</style></head><body><h1>Environment Matrix Report</h1><p>${escapeHtml(title)}</p><table><thead><tr><th>Item</th><th>Environment</th><th>Status</th><th>Time</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table><h2>Differences</h2><table><thead><tr><th>Item</th><th>Field</th><th>Values</th></tr></thead><tbody>${diffRows || '<tr><td colspan="3">No differences detected.</td></tr>'}</tbody></table></body></html>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

function requestOptions(collections: ReturnType<typeof useCollectionsStore.getState>['collections']) {
  return collections.flatMap((collection) => collection.children.flatMap(flattenRequests).map((request) => ({ collection, request })))
}

export function MatrixPanel() {
  const collections = useCollectionsStore((s) => s.collections)
  const environments = useEnvironmentsStore((s) => s.environments)
  const savedConfig = loadMatrixConfig()
  const [mode, setMode] = useState<MatrixMode>('request')
  const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>(savedConfig?.envIds?.length ? savedConfig.envIds : environments.map((env) => env.id))
  const [excludeText, setExcludeText] = useState((savedConfig?.excludeFields?.length ? savedConfig.excludeFields : DEFAULT_EXCLUDES).join('\n'))
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '')
  const [requestId, setRequestId] = useState('')
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([newFlowStep(1)])
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<MatrixEntry[]>([])
  const [progress, setProgress] = useState('')

  const requests = useMemo(() => requestOptions(collections), [collections])
  const selectedRequest = requests.find((item) => item.request.id === requestId)?.request ?? requests[0]?.request
  const selectedCollection = collections.find((collection) => collection.id === collectionId) ?? collections[0]
  const selectedEnvs = environments.filter((env) => selectedEnvIds.includes(env.id))
  const excludes = excludeText.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
  const diffs = useMemo(() => buildDiffs(entries, excludes), [entries, excludes])

  const updateFlowStep = (id: string, patch: Partial<FlowStep['request']> & { name?: string }) => {
    setFlowSteps((current) => current.map((step) => step.id === id
      ? { ...step, name: patch.name ?? step.name, request: { ...step.request, ...patch, name: patch.name ?? step.request.name } }
      : step))
  }

  const selectedItemsTitle = mode === 'request'
    ? selectedRequest?.name ?? 'Request'
    : mode === 'collection'
      ? selectedCollection?.name ?? 'Collection'
      : 'Flow'

  const run = async () => {
    if (selectedEnvs.length === 0) return
    setRunning(true)
    setEntries([])
    setProgress('')
    const nextEntries: MatrixEntry[] = []
    const runOne = async (env: Environment, itemName: string, request: RequestItem, vars: Record<string, string>) => {
      const start = performance.now()
      try {
        const execution = await executeRequest(request, vars)
        const response = execution.response
        for (const [key, value] of Object.entries(execution.mutations)) {
          if (value === null) delete vars[key]
          else vars[key] = value
        }
        nextEntries.push({ envId: env.id, envName: env.name, itemName, response, durationMs: Math.round(performance.now() - start), error: response.error?.message })
      } catch (error) {
        nextEntries.push({ envId: env.id, envName: env.name, itemName, response: null, durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) })
      }
      setEntries([...nextEntries])
    }

    try {
      for (const env of selectedEnvs) {
        const baseVars = envVars(env)
        setProgress(env.name)
        if (mode === 'request' && selectedRequest) {
          await runOne(env, selectedRequest.name, selectedRequest, baseVars)
        } else if (mode === 'collection' && selectedCollection) {
          const all = selectedCollection.children.flatMap(flattenRequests)
          for (const request of all) {
            await runOne(env, request.name, request, baseVars)
          }
        } else {
          let vars = { ...baseVars }
          for (const step of flowSteps) {
            await runOne(env, step.name, { ...step.request, name: step.name }, vars)
            const latest = nextEntries[nextEntries.length - 1]
            if (latest?.response?.body) {
              try {
                const extracted: Record<string, string> = {}
                flattenJson(step.name, JSON.parse(latest.response.body), extracted)
                vars = { ...vars, ...extracted, [`${step.name}.status`]: String(latest.response.status) }
              } catch {
                vars = { ...vars, [`${step.name}.body`]: latest.response.body, [`${step.name}.status`]: String(latest.response.status) }
              }
            }
          }
        }
      }
    } finally {
      setRunning(false)
      setProgress('')
    }
  }

  const saveConfig = () => {
    saveMatrixConfig({ envIds: selectedEnvIds, excludeFields: excludes })
  }

  const exportBaseName = `matrix-${Date.now()}`

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-border-1 bg-surface-1 p-3">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch size={15} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-1">Compare configuration</h2>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-1 rounded bg-surface-0 p-1">
          {(['request', 'collection', 'flow'] as MatrixMode[]).map((item) => (
            <button key={item} onClick={() => setMode(item)} className={cn('rounded px-2 py-1.5 text-[11px] capitalize', mode === item ? 'bg-accent text-white' : 'text-text-3 hover:text-text-1')}>
              {item}
            </button>
          ))}
        </div>

        {mode === 'request' && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-text-4">Request</span>
            <select value={selectedRequest?.id ?? ''} onChange={(e) => setRequestId(e.target.value)} className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-xs text-text-1">
              {requests.map(({ collection, request }) => <option key={request.id} value={request.id}>{collection.name} / {request.name}</option>)}
            </select>
          </label>
        )}

        {mode === 'collection' && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-text-4">Collection</span>
            <select value={selectedCollection?.id ?? ''} onChange={(e) => setCollectionId(e.target.value)} className="h-8 rounded border border-border-2 bg-surface-0 px-2 text-xs text-text-1">
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
          </label>
        )}

        {mode === 'flow' && (
          <div className="mb-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-text-4">Flow Steps</span>
              <button onClick={() => setFlowSteps((steps) => [...steps, newFlowStep(steps.length + 1)])} className="flex items-center gap-1 text-[10px] text-accent"><Plus size={10} /> Step</button>
            </div>
            {flowSteps.map((step) => (
              <div key={step.id} className="rounded border border-border-1 bg-surface-0 p-2">
                <div className="mb-1 flex gap-1">
                  <input value={step.name} onChange={(e) => updateFlowStep(step.id, { name: e.target.value })} className="h-7 w-24 rounded border border-border-2 bg-surface-2 px-2 text-[11px] text-text-1" />
                  <select value={step.request.method} onChange={(e) => updateFlowStep(step.id, { method: e.target.value as HttpMethod })} className="h-7 rounded border border-border-2 bg-surface-2 px-1 text-[11px] text-text-1">
                    {METHODS.map((method) => <option key={method}>{method}</option>)}
                  </select>
                  <button onClick={() => setFlowSteps((steps) => steps.filter((item) => item.id !== step.id))} disabled={flowSteps.length === 1} className="ml-auto text-text-4 hover:text-error disabled:opacity-30"><Trash2 size={12} /></button>
                </div>
                <input value={step.request.url} onChange={(e) => updateFlowStep(step.id, { url: e.target.value })} placeholder="https://api.local/{{path}}" className="h-7 w-full rounded border border-border-2 bg-surface-2 px-2 font-mono text-[11px] text-text-1" />
                {['POST', 'PUT', 'PATCH'].includes(step.request.method) && (
                  <textarea value={step.request.bodies[step.request.activeBodyIdx]?.raw ?? ''} onChange={(e) => {
                    const bodies = [...step.request.bodies]
                    bodies[step.request.activeBodyIdx] = { ...bodies[step.request.activeBodyIdx], type: 'raw', raw: e.target.value }
                    updateFlowStep(step.id, { bodies })
                  }} rows={3} className="mt-1 w-full resize-none rounded border border-border-2 bg-surface-2 p-2 font-mono text-[11px] text-text-1" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mb-3">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-4">Environments</span>
          <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded border border-border-1 bg-surface-0 p-2">
            {environments.map((env) => (
              <label key={env.id} className="flex items-center gap-2 text-xs text-text-2">
                <input type="checkbox" checked={selectedEnvIds.includes(env.id)} onChange={(e) => setSelectedEnvIds((ids) => e.target.checked ? [...ids, env.id] : ids.filter((id) => id !== env.id))} className="accent-accent" />
                {env.name}
              </label>
            ))}
            {environments.length === 0 && <span className="py-4 text-center text-[11px] text-text-4">No environments configured</span>}
          </div>
        </div>

        <label className="mb-3 flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-4">Exclude dynamic fields</span>
          <textarea value={excludeText} onChange={(e) => setExcludeText(e.target.value)} rows={6} className="resize-none rounded border border-border-2 bg-surface-0 p-2 font-mono text-[11px] text-text-1" placeholder="json:timestamp&#10;header:date" />
        </label>

        <div className="flex gap-2">
          <button onClick={run} disabled={running || selectedEnvs.length === 0} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">
            <Play size={13} /> {running ? `Running ${progress}` : 'Run Matrix'}
          </button>
          <button onClick={saveConfig} className="grid h-8 w-8 place-items-center rounded border border-border-2 bg-surface-0 text-text-3 hover:text-text-1" title="Save matrix config">
            <Save size={13} />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-1 px-4">
          <span className="text-xs font-semibold text-text-2">{selectedItemsTitle}</span>
          <span className="text-[10px] text-text-4">{entries.length} result rows / {diffs.length} differences</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => downloadText(`${exportBaseName}.md`, exportMarkdown(entries, diffs, selectedItemsTitle), 'text/markdown')} disabled={entries.length === 0} title="Export Markdown" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><FileText size={13} /></button>
            <button onClick={() => downloadText(`${exportBaseName}.html`, exportHtml(entries, diffs, selectedItemsTitle), 'text/html')} disabled={entries.length === 0} title="Export HTML" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><FileCode size={13} /></button>
            <button onClick={() => downloadText(`${exportBaseName}.json`, JSON.stringify({ scope: selectedItemsTitle, entries, diffs, excludes, timestamp: new Date().toISOString() }, null, 2), 'application/json')} disabled={entries.length === 0} title="Export JSON" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><FileJson size={13} /></button>
            <button onClick={() => downloadText(`${exportBaseName}-raw.json`, JSON.stringify(entries, null, 2), 'application/json')} disabled={entries.length === 0} title="Export raw results" className="grid h-7 w-7 place-items-center rounded text-text-4 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Download size={13} /></button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(220px,0.9fr)_minmax(240px,1fr)]">
          <section className="overflow-auto border-b border-border-1">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-surface-1 text-text-4">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Environment</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Time</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2">Content-Type</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const bad = entry.error || entry.response?.error || (entry.response?.status ?? 0) >= 400
                  return (
                    <tr key={`${entry.envId}-${entry.itemName}-${index}`} className="border-b border-border-1/60 hover:bg-surface-1">
                      <td className="px-3 py-2 font-medium text-text-2">{entry.itemName}</td>
                      <td className="px-3 py-2 text-text-3">{entry.envName}</td>
                      <td className={cn('px-3 py-2 font-mono', bad ? 'text-error' : 'text-success')}>{entry.error || entry.response?.error?.message || `${entry.response?.status ?? 'ERR'} ${entry.response?.statusText ?? ''}`}</td>
                      <td className="px-3 py-2 text-right font-mono text-text-3">{entry.durationMs}ms</td>
                      <td className="px-3 py-2 text-right font-mono text-text-3">{entry.response?.size ?? 0}B</td>
                      <td className="px-3 py-2 font-mono text-text-4">{entry.response?.contentType ?? '-'}</td>
                    </tr>
                  )
                })}
                {entries.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-16 text-center text-xs text-text-4">Run the matrix to compare environments.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="min-h-0 overflow-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-text-2">Differences</h3>
              {diffs.length > 0 && <button onClick={() => setEntries([])} className="flex items-center gap-1 text-[10px] text-text-4 hover:text-error"><X size={10} /> Clear</button>}
            </div>
            <div className="flex flex-col gap-2">
              {diffs.map((diff, index) => (
                <div key={`${diff.itemName}-${diff.field}-${index}`} className={cn('rounded border p-3', diff.severity === 'critical' ? 'border-error/25 bg-error/8' : 'border-border-1 bg-surface-1')}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-1">{diff.itemName}</span>
                    <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px]', diff.severity === 'critical' ? 'bg-error/15 text-error' : 'bg-surface-2 text-text-3')}>{diff.field}</span>
                  </div>
                  <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
                    {diff.values.map((value) => (
                      <div key={value.envName} className="rounded border border-border-1 bg-surface-0 p-2">
                        <div className="mb-1 text-[10px] font-semibold text-accent">{value.envName}</div>
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-text-3">{value.value}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {entries.length > 0 && diffs.length === 0 && <div className="rounded border border-success/25 bg-success/8 px-3 py-8 text-center text-xs text-success">No differences detected with the current exclusions.</div>}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
