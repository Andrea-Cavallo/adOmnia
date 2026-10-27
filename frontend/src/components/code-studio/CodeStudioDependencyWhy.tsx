import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as GoIDE from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/goide'
import type { DependencyWhy } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/codestudio/models'
import { moduleFootprint } from '@/lib/code-studio/dependencyHeatmap'
import { useCodeStudioInsights } from '@/stores/codeStudioInsights'
import { useCodeStudioRuntimeProfile } from '@/stores/codeStudioRuntimeProfile'
import { formatBytes } from './CodeStudioBinaryInspector'

/** "Why is this dependency here?": import chain, importers, runtime and binary weight, vulnerabilities. */
export function CodeStudioDependencyWhy({ sessionId, module, version, packages }: { sessionId: string; module: string; version?: string; packages: string[] }) {
  const [why, setWhy] = useState<DependencyWhy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runtime = useCodeStudioRuntimeProfile((state) => state.packages[sessionId] ?? null)
  const binary = useCodeStudioInsights((state) => state.binaries[sessionId] ?? null)
  const vulns = useCodeStudioInsights((state) => state.vulns[sessionId] ?? null)
  const whyKey = `${sessionId}|${module}`
  const [prevWhyKey, setPrevWhyKey] = useState(whyKey)
  if (prevWhyKey !== whyKey) {
    setPrevWhyKey(whyKey)
    setWhy(null)
  }
  useEffect(() => {
    let cancelled = false
    GoIDE.DependencyWhy(sessionId, module).then((result) => { if (!cancelled) setWhy(result) }, (problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : String(problem)) })
    return () => { cancelled = true }
  }, [sessionId, module])
  const footprint = moduleFootprint(module, runtime, binary?.packages ?? null)
  const findings = (vulns?.findings ?? []).filter((finding) => finding.module === module)
  return (
    <section aria-label="Why is this dependency here" className="col-span-full rounded-md border border-border-1 p-2">
      <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-4">Why is {module}{version ? `@${version}` : ''} here?</h3>
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-text-4">Import chain</dt>
        <dd className="min-w-0">
          {error ? <span className="text-danger">{error}</span> : !why ? <span className="flex items-center gap-1 text-text-3"><Loader2 size={11} className="animate-spin" />go mod why -m…</span>
            : why.needed ? <span className="font-mono text-text-2">{why.chain.join(' → ')}</span>
              : <span className="text-warning">{why.message || 'The main module does not need it: go mod tidy can remove it.'}</span>}
        </dd>
        <dt className="text-text-4">Imported by</dt>
        <dd className="font-mono text-text-2">{packages.length ? packages.join(', ') : 'no package of the project (indirect)'}</dd>
        <dt className="text-text-4">Runtime usage</dt>
        <dd className="text-text-2">{footprint.runtimeShare === null ? 'Load a profile in Performance Studio to see it.' : `${(footprint.runtimeShare * 100).toFixed(1)}% of ${runtime?.profile} (${runtime?.metric}), inclusive`}</dd>
        <dt className="text-text-4">Binary size</dt>
        <dd className="text-text-2">{footprint.binaryBytes === null ? 'Inspect a binary in Architecture → Binary to see it.' : `${formatBytes(footprint.binaryBytes)} of ${formatBytes(binary?.size ?? 0)} (${binary?.path})`}</dd>
        <dt className="text-text-4">Security</dt>
        <dd className="text-text-2">
          {!vulns ? 'Run the vulnerability scan (Security → Dependencies) to see it.'
            : findings.length === 0 ? <span className="text-success">No known vulnerability in the last scan.</span>
              : findings.map((finding) => <span key={finding.id} className="mr-2 text-danger" title={finding.summary}>{finding.id}{finding.fixedVersion ? ` (fixed in ${finding.fixedVersion})` : ''}</span>)}
        </dd>
      </dl>
    </section>
  )
}
