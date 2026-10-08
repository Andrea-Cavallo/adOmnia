import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, Loader2, Sparkles } from 'lucide-react'
import type { GoIDEDiagnostic, GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
import { GoStudioFileIcon } from './GoStudioFileIcon'
import { mergedReports, useGoIDELspStore } from '@/stores/goideLsp'
import { navigateToLocation } from './goStudioLanguageFeatures'
import { MAX_RESOLVE_ALL_FILES, fixGoStudioProblemWithAI, resolveAllGoStudioProblemsWithAI, type AIFixTarget } from './goStudioAIFixRunner'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useSettingsStore } from '@/stores/settings'
import { useIDEExtensionsStore } from '@/stores/ideExtensions'

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
  const extensionReports = useIDEExtensionsStore(state => state.reports[sessionId] ?? EMPTY_REPORTS)
  const reports = useGoIDELspStore((state) => state.diagnostics[sessionId] ?? EMPTY_REPORTS)
  const lintReports = useGoIDELspStore((state) => state.lint[sessionId]?.reports ?? EMPTY_REPORTS)
  const sorted = useMemo(() => sortReports([...Object.values(mergedReports(reports, lintReports)),...Object.values(extensionReports).filter(report => report.diagnostics.length)]), [lintReports, reports,extensionReports])
  const aiAvailable = useSettingsStore((state) => isAICompanionAvailable(state.settings.ai))
  const [resolving, setResolving] = useState(false)
  const problem = (item: GoIDEDiagnostic) => ({ message: item.message, line: item.range.startLine, source: item.source || undefined })
  // Errori e avvisi dei file del progetto: le informazioni non si inviano all'AI.
  const fixTargets = useMemo<AIFixTarget[]>(() => sorted.flatMap((report) => {
    const problems = report.diagnostics.filter((item) => item.severity <= 2).sort((left, right) => left.severity - right.severity).map(problem)
    return report.relativePath && problems.length > 0 ? [{ relativePath: report.relativePath, problems }] : []
  }), [sorted])
  const resolveAll = async () => {
    setResolving(true)
    try { await resolveAllGoStudioProblemsWithAI(fixTargets) } finally { setResolving(false) }
  }
  const fixWithAI = (report: GoIDEDiagnosticsReport, diagnostic: GoIDEDiagnostic) => {
    const others = report.diagnostics.filter((item) => item !== diagnostic && item.severity <= 2).map(problem)
    void fixGoStudioProblemWithAI(report.relativePath ?? '', problem(diagnostic), others)
  }

  const open = (report: GoIDEDiagnosticsReport, diagnostic: GoIDEDiagnostic) => navigateToLocation({
    uri: report.uri, path: report.path, relativePath: report.relativePath, external: !report.relativePath, range: diagnostic.range,
  })

  if (sorted.length === 0 && buildProblems.length === 0) {
    return <p className="p-3 text-[10px] text-text-4">No problems. gopls diagnostics, linter findings and build errors appear here.</p>
  }
  return (
    <div role="tree" aria-label="Problems" className="py-1 text-[11px]">
      {aiAvailable && fixTargets.length > 0 && (
        <div className="flex h-7 items-center gap-2 border-b border-border-1 px-2 pb-1">
          <span className="text-[10px] text-text-4">{fixTargets.reduce((total, target) => total + target.problems.length, 0)} errors and warnings in {fixTargets.length} file{fixTargets.length === 1 ? '' : 's'}</span>
          <button type="button" disabled={resolving} onClick={() => void resolveAll()} title={`Asks the AI for a fix per file (up to ${MAX_RESOLVE_ALL_FILES} files), then shows every change for you to review and confirm. Nothing is written before you apply it.`} className="ml-auto flex h-6 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 text-[10px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
            {resolving ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} aria-hidden="true" />} Resolve all with AI
          </button>
        </div>
      )}
      {sorted.map((report) => (
        <div key={report.uri} role="treeitem" aria-expanded="true">
          <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2"><GoStudioFileIcon name={(report.relativePath || report.path).split(/[\\/]/).pop() ?? (report.relativePath || report.path)} relativePath={report.relativePath} size={12} />{report.relativePath || report.path}<span className="text-[9px] text-text-4">{report.diagnostics.length}</span></div>
          {[...report.diagnostics].sort((left, right) => left.severity - right.severity || left.range.startLine - right.range.startLine).map((diagnostic, index) => (
            <div key={index} className="group flex min-h-6 w-full items-start hover:bg-surface-3 focus-within:bg-surface-3">
              <button type="button" onClick={() => open(report, diagnostic)} className="flex min-w-0 flex-1 items-start gap-1.5 py-0.5 pl-6 pr-2 text-left text-text-2 focus:outline-none">
                <SeverityIcon severity={diagnostic.severity} />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{diagnostic.message}</span>
                <span className="shrink-0 font-mono text-[9px] text-text-4">{diagnostic.source ? `${diagnostic.source} · ` : ''}{diagnostic.range.startLine}:{diagnostic.range.startColumn}</span>
              </button>
              {aiAvailable && report.relativePath && diagnostic.severity <= 2 && (
                <button type="button" onClick={() => fixWithAI(report, diagnostic)} title="Fix with AI: proposes a change you review before applying" aria-label={`Fix with AI: ${diagnostic.message}`} className="mr-1 mt-0.5 flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-accent opacity-0 hover:bg-accent/10 focus:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100">
                  <Sparkles size={11} aria-hidden="true" /> Fix with AI
                </button>
              )}
            </div>
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
