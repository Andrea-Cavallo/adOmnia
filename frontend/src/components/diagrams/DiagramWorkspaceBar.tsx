/**
 * The workspace strip above the canvas: generate a diagram from the Code Studio project, switch the
 * architectural view, refresh from code and jump to an entity by name. It reads the analysis that
 * the Diagram Studio store already loaded, so searching never re-scans the workspace.
 */
import { useMemo, useRef, useState } from 'react'
import { Boxes, Loader2, RefreshCw, Search, X } from 'lucide-react'
import type { WorkspaceEntity } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/diagrams/models'
import type { DiagramViewKind } from '@/lib/diagrams/model'
import { useDiagramCodeGraph } from '@/stores/diagramCodeGraph'
import { useDiagramStudio } from '@/stores/diagramStudio'
import { useDiagramUi } from '@/stores/diagramStudioUi'
import { cn } from '@/lib/utils'

const VIEWS: ReadonlyArray<{ id: DiagramViewKind; label: string; hint: string }> = [
  { id: 'architecture', label: 'System Architecture', hint: 'Services, endpoints, topics, databases and external systems' },
  { id: 'service', label: 'Service Flow', hint: 'One service with its handlers, topics and data stores' },
  { id: 'functions', label: 'Function / Call Flow', hint: 'Callers and callees of the selected function' },
  { id: 'endpoints', label: 'Endpoint Flow', hint: 'Route → handler → downstream calls' },
  { id: 'osgi', label: 'OSGi / Legacy Flow', hint: 'Bundles, flows, subflows and activators' },
]

const KIND_LABEL: Record<string, string> = {
  service: 'service', endpoint: 'endpoint', topic: 'topic', table: 'table', external: 'external',
  function: 'function', method: 'method', flow: 'flow', subflow: 'subflow', type: 'type', bundle: 'bundle', entry: 'entry',
}

function Status() {
  const status = useDiagramCodeGraph((state) => state.status)
  const error = useDiagramCodeGraph((state) => state.error)
  const analysis = useDiagramCodeGraph((state) => state.analysis)
  const notes = useDiagramCodeGraph((state) => state.notes)
  if (status === 'analyzing') return <span className="diagram-code-status"><Loader2 size={11} className="animate-spin" /> Analysing…</span>
  if (status === 'error') return <span className="diagram-code-status diagram-code-status--error" title={error}>{error || 'Analysis failed'}</span>
  if (status !== 'ready' || !analysis) return null
  const sources = analysis.sources.map((source) => `${source.language} ${source.nodes}`).join(' · ')
  const languages = analysis.languages.length ? analysis.languages.join(', ') : 'no source'
  return (
    <span className="diagram-code-status" title={[notes.join(' '), sources].filter(Boolean).join('\n')}>
      {analysis.entities.length} entities · {languages}{analysis.truncated ? ' · truncated' : ''}
      {notes.length > 0 && <span className="diagram-code-dot" aria-label="The analysis reported a limitation" />}
    </span>
  )
}

export function DiagramWorkspaceBar() {
  const doc = useDiagramStudio((state) => state.doc)
  const analysis = useDiagramCodeGraph((state) => state.analysis)
  const view = useDiagramCodeGraph((state) => state.view)
  const status = useDiagramCodeGraph((state) => state.status)
  const projectName = useDiagramCodeGraph((state) => state.projectName)
  const generate = useDiagramCodeGraph((state) => state.generate)
  const refresh = useDiagramCodeGraph((state) => state.refresh)
  const setView = useDiagramCodeGraph((state) => state.setView)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const generated = !!doc?.origin
  const project = projectName ?? 'the active Code Studio project'

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || !analysis) return []
    return analysis.entities
      .filter((entity) => entity.label.toLowerCase().includes(needle) || entity.file?.toLowerCase().includes(needle) || entity.id.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [analysis, query])

  const focusOfSelection = (): string | undefined => {
    const selected = doc?.nodes.find((node) => node.selected)?.data.source
    if (!selected) return undefined
    if (view === 'service') return analysis?.entities.find((entity) => entity.id === selected.entityId)?.service
    return selected.entityId
  }

  const chooseView = (next: DiagramViewKind) => {
    const focusId = next === 'service' ? (focusOfSelection() ?? analysis?.entities.find((entity) => entity.kind === 'service')?.id) : next === 'functions' ? focusOfSelection() : undefined
    void setView(next, focusId)
  }

  const revealEntity = (entity: WorkspaceEntity) => {
    setQuery('')
    const state = useDiagramCodeGraph.getState()
    if (!state.analysis || !state.sessionId) return
    const nodeId = useDiagramStudio.getState().revealEntity(entity, {
      sessionId: state.sessionId, workspaceId: state.workspaceId, fingerprint: state.analysis.fingerprint,
    })
    if (nodeId) useDiagramUi.getState().focusNode(nodeId)
  }

  return (
    <div className="diagram-workspace-bar" role="toolbar" aria-label="Workspace analysis">
      <button type="button" className={cn('diagram-bar-button', 'diagram-generate')} disabled={status === 'analyzing'}
        title={`Analyse ${project}`}
        onClick={() => void generate()}>
        <Boxes size={13} /><span>Generate from Workspace</span>
      </button>
      {generated && (
        <>
          <span className="diagram-bar-divider" aria-hidden="true" />
          <select className="diagram-view-select" value={view} title="Change the level of detail of the same graph"
            onChange={(event) => chooseView(event.target.value as DiagramViewKind)} aria-label="Diagram view">
            {VIEWS.map((entry) => <option key={entry.id} value={entry.id} title={entry.hint}>{entry.label}</option>)}
          </select>
          <button type="button" className="diagram-bar-button" disabled={status === 'analyzing'} title="Re-read the sources and update the structure, keeping the layout" onClick={() => void refresh()}>
            <RefreshCw size={12} /><span>Refresh from Code</span>
          </button>
          <div className="diagram-code-search">
            <Search size={12} aria-hidden="true" />
            <input ref={inputRef} value={query} placeholder="Search service, method, endpoint, topic, file…"
              onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }} aria-label="Search the analysed workspace" />
            {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}><X size={11} /></button>}
            {query && (
              <div className="diagram-code-results" role="listbox">
                {results.map((entity) => (
                  <button key={entity.id} type="button" role="option" aria-selected={false} onClick={() => revealEntity(entity)}>
                    <span className={cn('diagram-code-kind', `diagram-code-kind--${entity.kind}`)}>{KIND_LABEL[entity.kind] ?? entity.kind}</span>
                    <span className="diagram-code-result-label">{entity.label}</span>
                    {entity.file && <span className="diagram-code-result-file">{entity.file}{entity.line ? `:${entity.line}` : ''}</span>}
                  </button>
                ))}
                {results.length === 0 && <p className="diagram-empty-hint">No entity matches “{query}”.</p>}
              </div>
            )}
          </div>
        </>
      )}
      <div className="diagram-bar-spacer" />
      <Status />
    </div>
  )
}
