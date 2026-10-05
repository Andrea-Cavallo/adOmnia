import { goModules } from '@/lib/goide/goProject'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, Download, Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react'
import {
  getGoIDEDependencyGraph,
  listGoIDEDependencyUpdates,
  scanGoIDEDependencyVulnerabilities,
  type GoIDEDependencyGraphReport,
  type GoIDESession,
} from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'

interface GoStudioDependencyGraphProps {
  open: boolean
  session: GoIDESession
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return ''
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function GoStudioDependencyGraph({ open, session, onClose }: GoStudioDependencyGraphProps) {
  const [moduleDirectory, setModuleDirectory] = useState(goModules(session.project)[0]?.path ?? '')
  const [report, setReport] = useState<GoIDEDependencyGraphReport | null>(null)
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [vulns, setVulns] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState<'updates' | 'vulns' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)

  const load = async (directory = moduleDirectory) => {
    if (!directory) return
    setLoading(true)
    setError(null)
    try {
      setReport(await getGoIDEDependencyGraph(session.id, directory))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const directory = goModules(session.project)[0]?.path ?? ''
    setModuleDirectory(directory)
    setReport(null)
    setUpdates({})
    setVulns({})
    if (directory) void load(directory)
  }, [open, session.id])

  if (!open) return null

  const checkUpdates = async () => {
    setChecking('updates')
    setError(null)
    try {
      const list = await listGoIDEDependencyUpdates(session.id, moduleDirectory)
      setUpdates(Object.fromEntries(list.flatMap((item) => (item.latest ? [[item.path, item.latest]] : []))))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setChecking(null)
    }
  }

  const scanVulns = async () => {
    setChecking('vulns')
    setError(null)
    try {
      const list = await scanGoIDEDependencyVulnerabilities(session.id, moduleDirectory)
      const counts: Record<string, number> = {}
      for (const item of list) counts[item.module] = (counts[item.module] ?? 0) + 1
      setVulns(counts)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setChecking(null)
    }
  }

  const nodes = (report?.nodes ?? []).filter((node) => !node.main)

  const exportReport = () => {
    if (!report) return
    const payload = {
      generatedAt: new Date().toISOString(),
      ...report,
      updates,
      vulnerabilityCounts: vulns,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${report.modulePath.split('/').pop() || 'module'}-dependency-report.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center ad-modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Dependency graph" tabIndex={-1} className="flex max-h-[82vh] w-[760px] flex-col overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 shrink-0 items-center border-b border-border-1 px-4">
          <h2 className="text-xs font-semibold text-text-1">Dependency graph</h2>
          <span className="ml-2 text-[9px] text-text-4">tree, licenses, weight, duplicates</span>
          <button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {error && <div role="alert" className="mb-3 rounded border border-danger/30 bg-danger/10 p-2 text-[10px] text-danger">{error}</div>}
          {goModules(session.project).length === 0 ? (
            <div className="rounded border border-border-1 bg-surface-0 p-4 text-[11px] text-text-3">This project has no Go module. Create or open a folder containing go.mod first.</div>
          ) : (
            <>
              <div className="mb-3 flex items-end gap-2">
                <label className="min-w-0 flex-1 text-[10px] text-text-3">Module
                  <select value={moduleDirectory} onChange={(event) => { setModuleDirectory(event.target.value); void load(event.target.value) }} className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[10px] text-text-1">{goModules(session.project).map((module) => <option key={module.path} value={module.path}>{module.modulePath || module.path}</option>)}</select>
                </label>
                <button type="button" disabled={loading} onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded border border-border-1 text-text-3 hover:border-accent disabled:opacity-40">{loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}</button>
              </div>

              {report && (
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded border border-border-1 bg-surface-0 px-3 py-2 text-[9px] text-text-4">
                  <span>module <strong className="font-mono text-text-2">{report.modulePath}</strong></span>
                  <span><strong className="text-text-2">{report.directCount}</strong> direct</span>
                  <span><strong className="text-text-2">{report.totalCount}</strong> total</span>
                  <span>weight <strong className="text-text-2">{formatBytes(report.totalWeightBytes)}</strong></span>
                </div>
              )}

              <div className="mb-3 flex gap-2">
                <button type="button" disabled={!report || loading} onClick={exportReport} title="Export the current local dependency report as JSON" className="inline-flex h-7 items-center gap-1.5 rounded border border-border-1 px-2.5 text-[10px] text-text-2 hover:border-accent disabled:opacity-40"><Download size={11} />Export report</button>
                <button type="button" disabled={checking !== null} onClick={() => void checkUpdates()} className="inline-flex h-7 items-center gap-1.5 rounded border border-border-1 px-2.5 text-[10px] text-text-2 hover:border-accent disabled:opacity-40">{checking === 'updates' ? <Loader2 size={11} className="animate-spin" /> : <ArrowUpCircle size={11} />}Check updates</button>
                <button type="button" disabled={checking !== null} onClick={() => void scanVulns()} className="inline-flex h-7 items-center gap-1.5 rounded border border-border-1 px-2.5 text-[10px] text-text-2 hover:border-accent disabled:opacity-40">{checking === 'vulns' ? <Loader2 size={11} className="animate-spin" /> : <ShieldAlert size={11} />}Scan vulnerabilities</button>
                <span className="ml-auto text-[9px] leading-6 text-text-4">{Object.keys(vulns).length > 0 ? 'vulnerability badges loaded' : 'updates and vulnerabilities need the network'}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-auto rounded border border-border-1 bg-surface-0">
                {nodes.length === 0 && <p className="p-3 text-[10px] text-text-4">{loading ? 'Reading the module graph…' : 'No requirements in this go.mod.'}</p>}
                {nodes.map((node) => {
                  const latest = updates[node.path]
                  const vuln = vulns[node.path]
                  return (
                    <div key={`${node.path}@${node.version}`} className="group flex items-center gap-2 border-b border-border-1 px-3 py-1.5 last:border-b-0" style={{ paddingLeft: `${12 + node.depth * 16}px` }}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-text-2">
                          <span className="truncate">{node.path}</span>
                          {node.indirect && <span className="shrink-0 rounded bg-surface-2 px-1 text-[8px] text-text-4">indirect</span>}
                          {node.unused && <span className="shrink-0 rounded bg-warning/15 px-1 text-[8px] text-warning">unused</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[8px] text-text-4">
                          <span className="font-mono">{node.version}</span>
                          {node.license && <span className="rounded border border-border-1 px-1 font-mono text-text-3">{node.license}</span>}
                          {node.packageCount != null && node.packageCount > 0 && <span>{node.packageCount} packages</span>}
                          {node.weightBytes != null && node.weightBytes > 0 && <span>{formatBytes(node.weightBytes)}</span>}
                          {latest && latest !== node.version && <span className="font-semibold text-accent">latest {latest}</span>}
                          {vuln ? <span className="font-semibold text-danger">{vuln} vuln</span> : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {report && report.duplicates.length > 0 && (
                <div className="mt-3 shrink-0">
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-4">Duplicate transitive dependencies</div>
                  <div className="max-h-28 overflow-auto rounded border border-warning/25 bg-warning/5 px-3 py-2">
                    {report.duplicates.map((duplicate) => (
                      <div key={duplicate.path} className="py-1 text-[9px]">
                        <span className="font-mono text-text-2">{duplicate.path}</span>
                        {duplicate.versions.map((use) => (
                          <div key={use.version} className="ml-3 text-text-4">
                            <span className="font-mono text-text-3">{use.version}</span> ← {use.requiredBy.join(', ')}
                            {use.chain && use.chain.length > 0 && <div className="ml-3 font-mono text-[8px] text-text-4">{use.chain.join(' → ')}</div>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
