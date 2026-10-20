import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { AlertTriangle, GitCompare, RotateCcw, ShieldCheck } from 'lucide-react'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { CodeStudioEditorTabActions } from './CodeStudioEditorTabActions'
import { CodeStudioInspectionWidget } from './CodeStudioInspectionWidget'
import { CodeStudioCodeEditor, beforeCodeStudioMount, useCodeStudioEditorTheme } from './CodeStudioCodeEditor'
import { CodeStudioEditorTabs } from './CodeStudioEditorTabs'
import { CodeStudioSplitPane } from './CodeStudioSplitPane'
import type { CodeStudioRunTargetHandler } from './codeStudioRunTargets'
import { useCodeStudioDocumentSymbols } from './codeStudioSymbols'
import { copiesForKey } from './codeStudioSharedCopies'
import { useCodeStudioTestsStore, visibleCoverage } from '@/stores/codeStudioTests'
import { isGeneratedGoFile } from './codeStudioExtraLanguages'
import { coverageForDocument } from './codeStudioCoverage'
import { CodeStudioMarkdownDocument, isMarkdownDocument } from './CodeStudioMarkdownView'
import { CodeStudioImageView, isImageDocument } from './CodeStudioImageView'
import { CodeStudioHtmlView, isHtmlDocument, type CodeStudioHtmlMode } from './CodeStudioHtmlView'
import { CodeStudioLivePreview } from './CodeStudioLivePreview'
import { CodeStudioServerNotice } from './CodeStudioServerNotice'
import { CodeStudioPreviewSplit } from './CodeStudioPreviewSplit'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'

interface CodeStudioEditorProps {
  documents: GoIDEEditorDocument[]
  active: GoIDEEditorDocument | null
  onCursor: (line: number, column: number) => void
  onRequestClose: (documents: GoIDEEditorDocument[]) => void
  onRunTarget: CodeStudioRunTargetHandler
}

export function CodeStudioEditor({ documents, active, onCursor, onRequestClose, onRunTarget }: CodeStudioEditorProps) {
  const [compare, setCompare] = useState(false)
  const [htmlModes, setHtmlModes] = useState<Record<string, CodeStudioHtmlMode>>({})
  const theme = useCodeStudioEditorTheme()
  const saveDocument = useCodeStudioStore((state) => state.saveDocument)
  const resolveExternalChange = useCodeStudioStore((state) => state.resolveExternalChange)
  const split = useCodeStudioStore((state) => (state.activeSessionId ? state.splitBySession[state.activeSessionId] ?? null : null))
  const splitDocument = split ? documents.find((item) => item.document.id === split.documentId) ?? null : null
  const allDocuments = useCodeStudioStore((state) => state.documents)
  const sessions = useCodeStudioStore((state) => state.sessions)
  const activeSessionId = useCodeStudioStore((state) => state.activeSessionId)
  // La preview vive nella sessione anche quando nessun file è aperto.
  const previewSessionId = active?.document.sessionId ?? activeSessionId ?? undefined
  const livePreview = useLivePreviewStore((state) => selectSessionPreview(state, previewSessionId))
  const previewSession = previewSessionId ? sessions.find((item) => item.id === previewSessionId) : undefined
  const previewInSplit = !!previewSession && livePreview.visible && livePreview.placement === 'split'
  const previewInTab = !!previewSession && livePreview.visible && livePreview.placement === 'tab'
  const previewTabShown = previewInTab && livePreview.tabActive
  const coverage = useCodeStudioTestsStore((state) => (active ? visibleCoverage(state, active.document.sessionId) : null))
  const coverageMatch = active ? coverageForDocument(coverage, active.document.relativePath, active.diskToken, active.dirty) : { state: 'none' as const }
  // Voce 3 (REFACTOR.md): il banner "aperto anche altrove" si memoizza sulle sole chiavi
  // del documento attivo, non sull'oggetto documento che cambia a ogni battuta.
  const activePath = active?.document.path ?? ''
  const activeSession = active?.document.sessionId ?? ''
  const activeReadOnly = active?.document.readOnly ?? false
  const dirtyElsewhere = useMemo(
    () => (activePath ? copiesForKey(allDocuments, { path: activePath, sessionId: activeSession, readOnly: activeReadOnly }).filter((item) => item.dirty) : []),
    [allDocuments, activePath, activeSession, activeReadOnly],
  )
  const elsewhereNames = dirtyElsewhere.map((item) => sessions.find((session) => session.id === item.document.sessionId)?.project.name ?? 'another project')
  useCodeStudioDocumentSymbols(active)

  useEffect(() => { setCompare(false) }, [active?.document.id])

  // Open In → Browser: forza la modalità preview del documento HTML appena aperto.
  const htmlPreviewRequest = useCodeStudioStore((state) => state.htmlPreviewRequest)
  const consumedHtmlPreviewToken = useRef(0)
  useEffect(() => {
    if (!htmlPreviewRequest || htmlPreviewRequest.token === consumedHtmlPreviewToken.current) return
    consumedHtmlPreviewToken.current = htmlPreviewRequest.token
    if (active && isHtmlDocument(active)) {
      setHtmlModes((modes) => ({ ...modes, [active.document.id]: htmlPreviewRequest.mode }))
    }
  }, [htmlPreviewRequest, active])


  if (!active) {
    const empty = (
      <section aria-label="Editor" className="flex min-h-0 flex-1 items-center justify-center">
        <div className="text-center text-[11px] text-text-4">
          <p className="font-medium text-text-3">Open a file from Project</p>
          <p className="mt-1">Go to File: Ctrl/Cmd+P · Symbol: Ctrl/Cmd+T · Find in Files: Ctrl/Cmd+Shift+F</p>
        </div>
      </section>
    )
    if (previewInTab && previewSession) {
      return (
        <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CodeStudioEditorTabs
            documents={documents} activeId="" onRequestClose={onRequestClose}
            previewTab={{ active: livePreview.tabActive, label: 'Live Preview', onSelect: () => useLivePreviewStore.getState().setTabActive(previewSession.id, true), onClose: () => useLivePreviewStore.getState().hide(previewSession.id) }}
            onSelectDocument={() => useLivePreviewStore.getState().setTabActive(previewSession.id, false)}
          />
          <div className="relative flex min-h-0 min-w-0 flex-1">{livePreview.tabActive ? <CodeStudioLivePreview session={previewSession} embedded /> : empty}</div>
        </section>
      )
    }
    return <CodeStudioPreviewSplit session={previewSession} open={previewInSplit} editor={empty} />
  }

  const main = (
    <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CodeStudioEditorTabs
        documents={documents} activeId={active.document.id} onRequestClose={onRequestClose}
        actions={<CodeStudioEditorTabActions document={active} onSave={() => void saveDocument(active.document.id)} />}
        previewTab={previewInTab ? { active: livePreview.tabActive, label: 'Live Preview', onSelect: () => useLivePreviewStore.getState().setTabActive(active.document.sessionId, true), onClose: () => useLivePreviewStore.getState().hide(active.document.sessionId) } : undefined}
        onSelectDocument={previewInTab ? () => useLivePreviewStore.getState().setTabActive(active.document.sessionId, false) : undefined}
      />
      <CodeStudioServerNotice document={active} />
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
      <div data-code-studio-editor-host className={`relative min-h-0 flex-1 ${previewTabShown ? 'hidden' : ''}`}>
        {compare && active.externalState ? (
          <DiffEditor
            original={active.externalState.content ?? ''}
            modified={active.buffer}
            language={active.document.language}
            theme={theme}
            beforeMount={beforeCodeStudioMount}
            originalModelPath={`inmemory://disk-compare/original/${active.document.id}`}
            modifiedModelPath={`inmemory://disk-compare/current/${active.document.id}`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={{ automaticLayout: true, mouseWheelZoom: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          />
        ) : isImageDocument(active) ? (
          <CodeStudioImageView document={active} />
        ) : isHtmlDocument(active) ? (
          <CodeStudioHtmlView
            document={active}
            mode={htmlModes[active.document.id] ?? (previewInSplit || previewInTab ? 'editor' : 'split')}
            onModeChange={(mode) => setHtmlModes((modes) => ({ ...modes, [active.document.id]: mode }))}
            editor={<CodeStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />}
          />
        ) : isMarkdownDocument(active) ? (
          <CodeStudioMarkdownDocument
            document={active}
            editor={<CodeStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />}
          />
        ) : (
          <>
            <CodeStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />
            <CodeStudioInspectionWidget document={active} />
          </>
        )}
      </div>
      {previewTabShown && previewSession && <div className="relative flex min-h-0 min-w-0 flex-1"><CodeStudioLivePreview session={previewSession} embedded /></div>}
    </section>
  )

  const body = !split || !splitDocument ? main : (
    <div className={`flex min-h-0 min-w-0 flex-1 ${split.orientation === 'right' ? 'flex-row' : 'flex-col'}`}>
      {main}
      <div className={split.orientation === 'right' ? 'w-px shrink-0 bg-border-1' : 'h-px shrink-0 bg-border-1'} />
      <CodeStudioSplitPane documents={documents} document={splitDocument} onRunTarget={onRunTarget} onCursor={onCursor} />
    </div>
  )
  return <CodeStudioPreviewSplit session={previewSession} open={previewInSplit} editor={body} />
}
