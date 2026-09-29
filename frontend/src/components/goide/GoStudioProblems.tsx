import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import type { GoIDEDiagnostic, GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
import { GoStudioFileIcon } from './GoStudioFileIcon'
import { mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'

export interface GoStudioBuildProblem {
  path: string
  line: number
  column: number
  text: string
}

interface GoStudioProblemsProps {
  sessionId: string
  buildProblems: GoStudioBuildProblem[]
  onOpenBuildProblem: (problem: GoStudioBuildProblem) => void
}

const EMPTY_REPORTS: Record<string, GoIDEDiagnosticsReport> = {}

function SeverityIcon({ severity }: { severity: number }) {
  if (severity === 1) return <AlertCircle size={11} className="shrink-0 text-danger" aria-label="error" />
  if (severity === 2) return <AlertTriangle size={11} className="shrink-0 text-warning" aria-label="warning" />
  return <Info size={11} className="shrink-0 text-accent" aria-label="information" />
}

function sortReports(reports: GoIDEDiagnosticsReport[]): GoIDEDiagnosticsReport[] {
  const worst = (report: GoIDEDiagnosticsReport) => Math.min(...report.diagnostics.map((diagnostic) => diagnostic.severity))
  return [...reports].sort((left, right) => worst(left) - worst(right) || (left.relativePath ?? left.path).localeCompare(right.relativePath ?? right.path))
}

export function GoStudioProblems({ sessionId, buildProblems, onOpenBuildProblem }: GoStudioProblemsProps) {
  const reports = useGoIDELspStore((state) => state.diagnostics[sessionId] ?? EMPTY_REPORTS)
  const lintReports = useGoIDELspStore((state) => state.lint[sessionId]?.reports ?? EMPTY_REPORTS)
  const sorted = useMemo(() => sortReports(Object.values(mergedReports(reports, lintReports))), [lintReports, reports])

  const open = (report: GoIDEDiagnosticsReport, diagnostic: GoIDEDiagnostic) => navigateToLocation({
    uri: report.uri, path: report.path, relativePath: report.relativePath, external: !report.relativePath, range: diagnostic.range,
  })

  if (sorted.length === 0 && buildProblems.length === 0) {
    return <p className="p-3 text-[10px] text-text-4">No problems. gopls diagnostics, linter findings and build errors appear here.</p>
  }
  return (
    <div role="tree" aria-label="Problems" className="py-1 text-[11px]">
      {sorted.map((report) => (
        <div key={report.uri} role="treeitem" aria-expanded="true">
          <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2"><GoStudioFileIcon name={(report.relativePath || report.path).split(/[\\/]/).pop() ?? (report.relativePath || report.path)} relativePath={report.relativePath} size={12} />{report.relativePath || report.path}<span className="text-[9px] text-text-4">{report.diagnostics.length}</span></div>
          {[...report.diagnostics].sort((left, right) => left.severity - right.severity || left.range.startLine - right.range.startLine).map((diagnostic, index) => (
            <button key={index} type="button" onClick={() => open(report, diagnostic)} className="flex min-h-6 w-full items-start gap-1.5 py-0.5 pl-6 pr-2 text-left text-text-2 hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
              <SeverityIcon severity={diagnostic.severity} />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{diagnostic.message}</span>
              <span className="shrink-0 font-mono text-[9px] text-text-4">{diagnostic.source ? `${diagnostic.source} · ` : ''}{diagnostic.range.startLine}:{diagnostic.range.startColumn}</span>
            </button>
          ))}
        </div>
      ))}
      {buildProblems.length > 0 && (
        <div role="treeitem" aria-expanded="true">
          <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2">Last build output<span className="text-[9px] text-text-4">{buildProblems.length}</span></div>
          {buildProblems.map((problem, index) => (
            <button key={`${problem.path}:${problem.line}:${index}`} type="button" onClick={() => onOpenBuildProblem(problem)} className="flex min-h-6 w-full items-start gap-1.5 py-0.5 pl-6 pr-2 text-left font-mono text-[10px] text-text-2 hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
              <AlertCircle size={11} className="mt-0.5 shrink-0 text-danger" /><span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{problem.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
