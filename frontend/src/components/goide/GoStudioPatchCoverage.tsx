import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { GoIDECoverageReport } from '@/lib/goide-tests-api'
import { getGoIDEPatchLines, type GoIDELineRange } from '@/lib/goide-vcs-api'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDEVCSStore } from '@/stores/goideVcs'
import { patchCoverage } from './goStudioCoverage'

const PREFERRED_BASES = ['main', 'master', 'develop', 'trunk']

/** Branch base proposto: il primo tra main/master/develop/trunk diverso dal branch corrente. */
export function defaultPatchBase(branches: readonly string[], current: string | undefined): string {
  const candidates = branches.filter((branch) => branch !== current)
  return PREFERRED_BASES.find((name) => candidates.includes(name)) ?? candidates[0] ?? ''
}

function coverageBar(value: number) {
  return <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-danger/25"><span className="block h-full bg-success" style={{ width: `${value}%` }} /></span>
}

/** Patch coverage come in una pull request: le sole righe cambiate dal merge-base con il branch base. */
export function GoStudioPatchCoverage({ sessionId, report }: { sessionId: string; report: GoIDECoverageReport }) {
  const status = useGoIDEVCSStore((state) => state.status[sessionId] ?? null)
  const openLocation = useGoIDEStore((state) => state.openLocation)
  const branches = useMemo(() => status?.branches ?? [], [status?.branches])
  const [base, setBase] = useState(() => defaultPatchBase(branches, status?.branch))
  const [lines, setLines] = useState<Record<string, GoIDELineRange[]> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (!status) void useGoIDEVCSStore.getState().refreshStatus(sessionId) }, [sessionId, status])
  useEffect(() => { if (!base) setBase(defaultPatchBase(branches, status?.branch)) }, [base, branches, status?.branch])
  useEffect(() => {
    if (!base) return
    let cancelled = false
    setLines(null)
    setError('')
    getGoIDEPatchLines(sessionId, base)
      .then((value) => { if (!cancelled) setLines(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [base, sessionId, report])
  const patch = useMemo(() => (lines ? patchCoverage(report, lines) : null), [lines, report])
  if (!status?.available) return <p className="text-[10px] text-text-4">Patch coverage needs a Git repository.</p>
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-text-2">
        <label className="flex items-center gap-1.5 text-[10px] text-text-3">
          Changes since
          <select value={base} onChange={(event) => setBase(event.target.value)} aria-label="Base branch" className="h-6 rounded border border-border-1 bg-surface-2 px-1 text-[10px] text-text-2">
            {branches.filter((branch) => branch !== status.branch).map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
        </label>
        {patch && patch.statements > 0 && <span className="font-medium">{coverageBar(patch.percent)} {patch.percent.toFixed(1)}% <span className="font-normal text-text-4">· {patch.covered}/{patch.statements} changed statements</span></span>}
        {!patch && !error && base && <Loader2 size={11} className="animate-spin text-text-4" aria-label="Loading" />}
      </div>
      {!base && <p className="text-[10px] text-text-4">No other branch to compare with.</p>}
      {error && <p className="text-[10px] text-danger">{error}</p>}
      {patch && patch.statements === 0 && <p className="text-[10px] text-text-4">No changed Go statements since {base} are in this coverage run.</p>}
      {patch?.files.map((file) => (
        <button key={file.relativePath} type="button" disabled={file.uncoveredLines.length === 0} onClick={() => void openLocation(file.relativePath, file.uncoveredLines[0] ?? 1, 1)} title={file.uncoveredLines.length ? `Uncovered changed lines: ${file.uncoveredLines.join(', ')}` : 'Every changed statement is covered'} className="flex h-6 w-full items-center gap-2 text-left text-text-3 enabled:hover:bg-surface-3 enabled:hover:text-text-1">
          {coverageBar((file.covered * 100) / file.statements)}<span className="w-12 shrink-0 text-right text-[10px]">{((file.covered * 100) / file.statements).toFixed(1)}%</span>
          <span className="truncate font-mono text-[10px]">{file.relativePath}</span>
          {file.uncoveredLines.length > 0 && <span className="ml-auto shrink-0 text-[10px] text-danger">{file.uncoveredLines.length} uncovered line{file.uncoveredLines.length === 1 ? '' : 's'}</span>}
        </button>
      ))}
    </div>
  )
}
