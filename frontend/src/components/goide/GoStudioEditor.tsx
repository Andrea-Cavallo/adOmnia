import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { AlertTriangle, GitCompare, RotateCcw, ShieldCheck } from 'lucide-react'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioEditorActions } from './GoStudioEditorActions'
import { GoStudioInspectionWidget } from './GoStudioInspectionWidget'
import { GoStudioCodeEditor, beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { GoStudioEditorTabs } from './GoStudioEditorTabs'
import { GoStudioSplitPane } from './GoStudioSplitPane'
import type { GoStudioRunTargetHandler } from './goStudioRunTargets'
import { useGoStudioDocumentSymbols } from './goStudioSymbols'
import { copiesInOtherSessions } from './goStudioSharedCopies'
import { useGoIDETestsStore, visibleCoverage } from '@/stores/goideTests'
import { isGeneratedGoFile } from './goStudioExtraLanguages'
import { coverageForDocument } from './goStudioCoverage'
import { GoStudioMarkdownView, isMarkdownDocument, type GoStudioMarkdownMode } from './GoStudioMarkdownView'

interface GoStudioEditorProps {
  documents: GoIDEEditorDocument[]
  active: GoIDEEditorDocument | null
  onCursor: (line: number, column: number) => void
  onRequestClose: (documents: GoIDEEditorDocument[]) => void
  onRunTarget: GoStudioRunTargetHandler
}

export function GoStudioEditor({ documents, active, onCursor, onRequestClose, onRunTarget }: GoStudioEditorProps) {
  const [compare, setCompare] = useState(false)
<<<<<<< HEAD
=======
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  // Vista Markdown per documento, come in JetBrains: default Editor + Preview.
  const [markdownModes, setMarkdownModes] = useState<Record<string, GoStudioMarkdownMode>>({})
>>>>>>> 20795a4 (feat: refresh hub, rail, and Go Studio workflows)
  const theme = useGoStudioEditorTheme()
  const saveDocument = useGoIDEStore((state) => state.saveDocument)
  const resolveExternalChange = useGoIDEStore((state) => state.resolveExternalChange)
  const split = useGoIDEStore((state) => (state.activeSessionId ? state.splitBySession[state.activeSessionId] ?? null : null))
  const splitDocument = split ? documents.find((item) => item.document.id === split.documentId) ?? null : null
  const allDocuments = useGoIDEStore((state) => state.documents)
  const sessions = useGoIDEStore((state) => state.sessions)
  const coverage = useGoIDETestsStore((state) => (active ? visibleCoverage(state, active.document.sessionId) : null))
  const coverageMatch = active ? coverageForDocument(coverage, active.document.relativePath, active.diskToken, active.dirty) : { state: 'none' as const }
  const dirtyElsewhere = active ? copiesInOtherSessions(allDocuments, active).filter((item) => item.dirty) : []
  const elsewhereNames = dirtyElsewhere.map((item) => sessions.find((session) => session.id === item.document.sessionId)?.project.name ?? 'another project')
  useGoStudioDocumentSymbols(active)

  useEffect(() => { setCompare(false) }, [active?.document.id])


  if (!active) {
    return (
      <section aria-label="Editor" className="flex min-h-0 flex-1 items-center justify-center">
        <div className="text-center text-[11px] text-text-4">
          <p className="font-medium text-text-3">Open a file from Project</p>
          <p className="mt-1">Go to File: Ctrl/Cmd+P · Symbol: Ctrl/Cmd+T · Find in Files: Ctrl/Cmd+Shift+F</p>
        </div>
      </section>
    )
  }

  const main = (
    <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GoStudioEditorTabs documents={documents} activeId={active.document.id} onRequestClose={onRequestClose} actions={<GoStudioEditorActions document={active} onSave={() => void saveDocument(active.document.id)} />} />
      {active.externalState && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
          <AlertTriangle size={12} /> This file changed on disk. Your buffer was preserved.
          <button type="button" onClick={() => resolveExternalChange(active.document.id, 'reload')} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-warning/10"><RotateCcw size={10} /> Reload</button>
          <button type="button" onClick={() => resolveExternalChange(active.document.id, 'keep')} className="rounded px-1.5 py-0.5 hover:bg-warning/10">Keep mine</button>
          <button type="button" onClick={() => setCompare((value) => !value)} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-warning/10"><GitCompare size={10} /> {compare ? 'Editor' : 'Compare'}</button>
        </div>
      )}
      {dirtyElsewhere.length > 0 && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-accent/25 bg-accent/10 px-2 py-1.5 text-[10px] text-text-2">
          <AlertTriangle size={12} className="text-accent" aria-hidden="true" />
          <span>Also open with unsaved changes in <strong>{elsewhereNames.join(', ')}</strong>. Saving one copy asks the other to reload or compare, never overwrites it.</span>
        </div>
      )}
      {coverageMatch.state === 'stale' && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border-1 px-2 py-1 text-[10px] text-text-3">
          <ShieldCheck size={12} className="text-text-4" aria-hidden="true" /> Coverage is outdated for this file: it changed after the test run. Run the tests with coverage again to see it.
        </div>
      )}
      {isGeneratedGoFile(active.document.relativePath, active.buffer) && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-warning/25 bg-warning/10 px-2 py-1 text-[10px] text-text-2">
          <AlertTriangle size={12} className="text-warning" aria-hidden="true" /> Generated file (Code generated … DO NOT EDIT). Change the generator or its input and run go generate instead of editing it.
        </div>
      )}
      {active.saveError && <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-[10px] text-danger">{active.saveError}</div>}
      <div className="relative min-h-0 flex-1">
        {compare && active.externalState ? (
          <DiffEditor
            original={active.externalState.content ?? ''}
            modified={active.buffer}
            language={active.document.language}
            theme={theme}
            beforeMount={beforeGoStudioMount}
            originalModelPath={`inmemory://disk-compare/original/${active.document.id}`}
            modifiedModelPath={`inmemory://disk-compare/current/${active.document.id}`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          />
        ) : isMarkdownDocument(active) ? (
          <GoStudioMarkdownView
            document={active}
            mode={markdownModes[active.document.id] ?? 'split'}
            onModeChange={(mode) => setMarkdownModes((modes) => ({ ...modes, [active.document.id]: mode }))}
            editor={<GoStudioCodeEditor document={active} handlesReveal onCursor={trackCursor} onRunTarget={onRunTarget} />}
          />
        ) : (
          <>
            <GoStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />
            <GoStudioInspectionWidget document={active} />
          </>
        )}
      </div>
    </section>
  )

  if (!split || !splitDocument) return main
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${split.orientation === 'right' ? 'flex-row' : 'flex-col'}`}>
      {main}
      <div className={split.orientation === 'right' ? 'w-px shrink-0 bg-border-1' : 'h-px shrink-0 bg-border-1'} />
      <GoStudioSplitPane documents={documents} document={splitDocument} onRunTarget={onRunTarget} onCursor={onCursor} />
    </div>
  )
}
