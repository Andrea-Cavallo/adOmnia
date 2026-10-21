import { useState } from 'react'
import { ArrowRight, FolderOpen, Search, Terminal, Layers } from 'lucide-react'
import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import { emptyRunConfiguration, templateKey, type RunTemplate } from '@/lib/code-studio/runFormTypes'
import { runTemplates } from '@/lib/code-studio/runFormSchema'
import { configurationCatalog, templateWorkingDirectory } from '@/lib/code-studio/runConfigurationCatalog'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { CodeStudioRunSuggestions } from './CodeStudioRunSuggestions'
interface Props {
  sessionId: string; busy: boolean
  onChoose: (draft: GoIDERunConfiguration) => void
}
const shellTemplate: RunTemplate = { language: '', kind: 'shell-command', label: 'Shell command', group: 'Generic' }
export function CodeStudioRunWizard({ sessionId, busy, onChoose }: Props) {
  const [query, setQuery] = useState('')
  const project = useCodeStudioStore(state => state.sessions.find(session => session.id === sessionId)?.project)
  const registered = useCodeStudioStore(state => state.capabilities?.languages)
  const savedCount = useCodeStudioStore(state => state.runConfigsBySession[sessionId]?.length ?? 0)
  const catalog = configurationCatalog([...runTemplates, shellTemplate], project, registered, query)
  const choose = (item: RunTemplate) => {
    if (item === shellTemplate) {
      const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
      onChoose({ ...emptyRunConfiguration(sessionId), name: 'Shell command', target: windows ? 'powershell.exe' : 'sh', programArguments: windows ? ['-NoProfile', '-Command', 'Write-Output "Hello"'] : ['-c', 'echo "Hello"'] })
      return
    }
    onChoose({ ...emptyRunConfiguration(sessionId), language: item.language, kind: item.kind as GoIDERunConfiguration['kind'], target: item.target ?? '', workingDirectory: templateWorkingDirectory(item, project), name: `${item.group} · ${item.label}`, languageOptions: {} })
  }
  const rows = (items: RunTemplate[]) => <div className="run-catalog-grid">{items.map(item => <button type="button" key={templateKey(item)} disabled={busy} className="run-catalog-item" onClick={() => choose(item)}>
    <span className="run-catalog-icon">{item.language ? <FolderOpen size={17} /> : item.kind === 'compound' ? <Layers size={17} /> : <Terminal size={17} />}</span>
    <span className="min-w-0 flex-1"><strong>{item.label}</strong><small>{item.group}{templateWorkingDirectory(item, project) ? ` · ${templateWorkingDirectory(item, project)}` : ''}</small></span><ArrowRight size={14} className="run-catalog-arrow" />
  </button>)}</div>
  return <div className="run-catalog">
    <header className="run-catalog-heading"><span className="run-eyebrow">NEW CONFIGURATION</span><h2>What would you like to run?</h2><p>Start with an entry from your project, or configure a target below.</p></header>
    {!query.trim() && <section className="run-detected"><CodeStudioRunSuggestions sessionId={sessionId} savedCount={savedCount} disabled={busy} mode="review" onAdd={async suggested => onChoose({ ...emptyRunConfiguration(sessionId), ...suggested, sessionId })} /></section>}
    <label className="run-search"><Search size={14} /><input aria-label="Search configuration types" placeholder="Search types or languages…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {catalog.project.length > 0 && <section><h3 className="run-section-heading">In this project <span>{catalog.project.length}</span></h3>{rows(catalog.project)}</section>}
    {catalog.tools.length > 0 && <section><h3 className="run-section-heading">Commands & orchestration</h3>{rows(catalog.tools)}</section>}
    {catalog.other.length > 0 && <details className="run-other-types" open={query.trim() ? true : undefined}><summary>Other languages <span>{catalog.other.length} types</span></summary>{rows(catalog.other)}</details>}
    {!catalog.project.length && !catalog.tools.length && !catalog.other.length && <p role="status" className="gs-list-empty">No configuration types match “{query}”.</p>}
    <p className="gs-hint mt-4">Detected entries open for review before saving. Commands run directly; use a shell executable when you need shell syntax.</p>
  </div>
}
