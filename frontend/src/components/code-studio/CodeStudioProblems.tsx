import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Download, Info, Loader2, Search, Sparkles } from 'lucide-react'
import type { GoIDEDiagnostic, GoIDEDiagnosticsReport } from '@/lib/code-studio-lsp-api'
import { CodeStudioFileIcon } from './CodeStudioFileIcon'
import { mergedReports, useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { navigateToLocation } from './codeStudioLanguageFeatures'
import { MAX_RESOLVE_ALL_FILES, fixCodeStudioProblemWithAI, resolveAllCodeStudioProblemsWithAI, type AIFixTarget } from './codeStudioAIFixRunner'
import { isAICompanionAvailable } from '@/lib/aiAvailability'
import { useSettingsStore } from '@/stores/settings'
import { useIDEExtensionsStore } from '@/stores/ideExtensions'
import { saveTextFile } from '@/lib/fileUtils'
import { problemsToMarkdown } from '@/lib/code-studio/problemsMarkdown'
import { groupProblemReports, buildProblemMatchesQuery, reportMatchesQuery } from '@/lib/code-studio/problemGroups'

export interface CodeStudioBuildProblem {
  path: string
  line: number
  column: number
  text: string
}

interface CodeStudioProblemsProps {
  sessionId: string
  buildProblems: CodeStudioBuildProblem[]
  onOpenBuildProblem: (problem: CodeStudioBuildProblem) => void
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

/** Il filtro decide se un file resta: messaggio, sorgente, percorso e severità (`error`/`warning`). */
function reportMatches(report: GoIDEDiagnosticsReport, query: string): boolean {
  return reportMatchesQuery(report, query)
}

function buildProblemMatches(problem: CodeStudioBuildProblem, query: string): boolean {
  return buildProblemMatchesQuery(problem, query)
}

export function CodeStudioProblems({ sessionId, buildProblems, onOpenBuildProblem }: CodeStudioProblemsProps) {
  const extensionReports = useIDEExtensionsStore(state => state.reports[sessionId] ?? EMPTY_REPORTS)
  const reports = useCodeStudioLspStore((state) => state.diagnostics[sessionId] ?? EMPTY_REPORTS)
  const lintReports = useCodeStudioLspStore((state) => state.lint[sessionId]?.reports ?? EMPTY_REPORTS)
  const project = useCodeStudioStore(state => state.sessions.find(session => session.id === sessionId)?.project)
  const sorted = useMemo(() => sortReports([...Object.values(mergedReports(reports, lintReports)),...Object.values(extensionReports).filter(report => report.diagnostics.length)]), [lintReports, reports,extensionReports])
  const aiAvailable = useSettingsStore((state) => isAICompanionAvailable(state.settings.ai))
  const [resolving, setResolving] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  // Il filtro è applicato prima dei gruppi: un'unità senza problemi visibili non compare.
  const visible = useMemo(() => sorted.filter((report) => reportMatches(report, query)), [sorted, query])
  const visibleBuild = useMemo(() => buildProblems.filter((problem) => buildProblemMatches(problem, query)), [buildProblems, query])
  const groups = useMemo(() => groupProblemReports(project, visible), [project, visible])

  const problem = (item: GoIDEDiagnostic) => ({ message: item.message, line: item.range.startLine, source: item.source || undefined })
  // Errori e avvisi dei file del progetto: le informazioni non si inviano all'AI.
  const fixTargets = useMemo<AIFixTarget[]>(() => visible.flatMap((report) => {
    const problems = report.diagnostics.filter((item) => item.severity <= 2).sort((left, right) => left.severity - right.severity).map(problem)
    return report.relativePath && problems.length > 0 ? [{ relativePath: report.relativePath, problems }] : []
  }), [visible])
  const resolveAll = async () => {
    setResolving(true)
    try { await resolveAllCodeStudioProblemsWithAI(fixTargets) } finally { setResolving(false) }
  }
  const fixWithAI = (report: GoIDEDiagnosticsReport, diagnostic: GoIDEDiagnostic) => {
    const others = report.diagnostics.filter((item) => item !== diagnostic && item.severity <= 2).map(problem)
    void fixCodeStudioProblemWithAI(report.relativePath ?? '', problem(diagnostic), others)
  }

  const exportMarkdown = () => { void saveTextFile('problems.md', problemsToMarkdown(sorted, buildProblems), 'text/markdown').catch(() => undefined) }

  const open = (report: GoIDEDiagnosticsReport, diagnostic: GoIDEDiagnostic) => navigateToLocation({
    uri: report.uri, path: report.path, relativePath: report.relativePath, external: !report.relativePath, range: diagnostic.range,
  })

  const toggle = (key: string) => setCollapsed(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  if (sorted.length === 0 && buildProblems.length === 0) {
    return <p className="p-3 text-[12px] text-text-4">No problems. gopls diagnostics, linter findings and build errors appear here.</p>
  }
  const total = visible.reduce((sum, report) => sum + report.diagnostics.length, 0) + visibleBuild.length
  return (
    <div role="tree" aria-label="Problems" className="py-1 text-[13px]">
      <div className="flex h-7 items-center gap-2 border-b border-border-1 px-2 pb-1">
        <label className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded border border-border-1 px-1.5 text-[12px] text-text-3 focus-within:border-accent">
          <Search size={11} aria-hidden="true" className="shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by file, unit, message or source"
            aria-label="Filter problems"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-text-1 outline-none placeholder:text-text-4"
          />
        </label>
        {aiAvailable && fixTargets.length > 0 && <span className="shrink-0 text-[12px] text-text-4">{fixTargets.reduce((sum, target) => sum + target.problems.length, 0)} in {fixTargets.length} file{fixTargets.length === 1 ? '' : 's'}</span>}
        <button type="button" onClick={exportMarkdown} title="Export every problem as a Markdown checklist (problems.md)" className="flex h-6 shrink-0 items-center gap-1.5 rounded border border-border-1 px-2 text-[12px] font-medium text-text-2 hover:bg-surface-3">
          <Download size={11} aria-hidden="true" /> Export as MD
        </button>
        {aiAvailable && fixTargets.length > 0 && (
          <button type="button" disabled={resolving} onClick={() => void resolveAll()} title={`Asks the AI for a fix per file (up to ${MAX_RESOLVE_ALL_FILES} files), then shows every change for you to review and confirm. Nothing is written before you apply it.`} className="flex h-6 shrink-0 items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 text-[12px] font-semibold text-accent hover:bg-accent/20 disabled:opacity-50">
            {resolving ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} aria-hidden="true" />} Resolve all with AI
          </button>
        )}
      </div>
      {query.trim() && total === 0 && <p className="px-2 py-2 text-[12px] text-text-4">No problems match “{query.trim()}”.</p>}
      {/* Un gruppo per unità di build: i file esterni al progetto hanno il loro gruppo in fondo (6.5). */}
      {groups.map((group) => {
        const expanded = !collapsed.has(group.key)
        return (
          <div key={group.key || 'outside'} role="treeitem" aria-expanded={expanded}>
            <button type="button" onClick={() => toggle(group.key)} className="flex h-6 w-full items-center gap-1.5 px-2 text-left font-semibold text-text-2 hover:bg-surface-3" title={group.key ? `${group.label} · grouped by build unit` : 'Files outside the project and its units'}>
              {expanded ? <ChevronDown size={11} aria-hidden="true" className="shrink-0" /> : <ChevronRight size={11} aria-hidden="true" className="shrink-0" />}
              {group.language && <span className="gs-badge shrink-0">{group.language.name}</span>}
              <span className="min-w-0 flex-1 truncate">{group.label || 'Project'}</span>
              <span className="shrink-0 text-[11px] font-normal text-text-4">{group.count}</span>
            </button>
            {expanded && group.reports.map((report) => (
              <div key={report.uri} role="treeitem" aria-expanded="true">
                <div className="flex h-6 items-center gap-1.5 pl-4 pr-2 font-medium text-text-2"><CodeStudioFileIcon name={(report.relativePath || report.path).split(/[\\/]/).pop() ?? (report.relativePath || report.path)} relativePath={report.relativePath} size={12} />{report.relativePath || report.path}<span className="text-[11px] text-text-4">{report.diagnostics.length}</span></div>
                {[...report.diagnostics].sort((left, right) => left.severity - right.severity || left.range.startLine - right.range.startLine).map((diagnostic, index) => (
                  <div key={index} className="group flex min-h-6 w-full items-start hover:bg-surface-3 focus-within:bg-surface-3">
                    <button type="button" onClick={() => open(report, diagnostic)} className="flex min-w-0 flex-1 items-start gap-1.5 py-0.5 pl-10 pr-2 text-left text-text-2 focus:outline-none">
                      <SeverityIcon severity={diagnostic.severity} />
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{diagnostic.message}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-4">{diagnostic.source ? `${diagnostic.source} · ` : ''}{diagnostic.range.startLine}:{diagnostic.range.startColumn}</span>
                    </button>
                    {aiAvailable && report.relativePath && diagnostic.severity <= 2 && (
                      <button type="button" onClick={() => fixWithAI(report, diagnostic)} title="Fix with AI: proposes a change you review before applying" aria-label={`Fix with AI: ${diagnostic.message}`} className="mr-1 mt-0.5 flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[12px] font-medium text-accent opacity-0 hover:bg-accent/10 focus:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100">
                        <Sparkles size={11} aria-hidden="true" /> Fix with AI
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      })}
      {visibleBuild.length > 0 && (
        <div role="treeitem" aria-expanded="true">
          <div className="flex h-6 items-center gap-1.5 px-2 font-medium text-text-2">Last build output<span className="text-[11px] text-text-4">{visibleBuild.length}</span></div>
          {visibleBuild.map((buildProblem, index) => (
            <button key={`${buildProblem.path}:${buildProblem.line}:${index}`} type="button" onClick={() => onOpenBuildProblem(buildProblem)} className="flex min-h-6 w-full items-start gap-1.5 py-0.5 pl-6 pr-2 text-left font-mono text-[12px] text-text-2 hover:bg-surface-3 focus:bg-surface-3 focus:outline-none">
              <AlertCircle size={11} className="mt-0.5 shrink-0 text-danger" /><span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{buildProblem.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
