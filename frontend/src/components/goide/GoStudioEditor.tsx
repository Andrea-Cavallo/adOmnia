import { useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { AlertTriangle, GitCompare, RotateCcw, ShieldCheck } from 'lucide-react'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioEditorTabActions } from './GoStudioEditorTabActions'
import { GoStudioInspectionWidget } from './GoStudioInspectionWidget'
import { GoStudioCodeEditor, beforeGoStudioMount, useGoStudioEditorTheme } from './GoStudioCodeEditor'
import { GoStudioEditorTabs } from './GoStudioEditorTabs'
import { GoStudioSplitPane } from './GoStudioSplitPane'
import type { GoStudioRunTargetHandler } from './goStudioRunTargets'
import { useGoStudioDocumentSymbols } from './goStudioSymbols'
import { copiesForKey } from './goStudioSharedCopies'
import { useGoIDETestsStore, visibleCoverage } from '@/stores/goideTests'
import { isGeneratedGoFile } from './goStudioExtraLanguages'
import { coverageForDocument } from './goStudioCoverage'
import { GoStudioMarkdownDocument, isMarkdownDocument } from './GoStudioMarkdownView'
import { GoStudioImageView, isImageDocument } from './GoStudioImageView'
import { GoStudioHtmlView, isHtmlDocument, type GoStudioHtmlMode } from './GoStudioHtmlView'
import { GoStudioLivePreview } from './GoStudioLivePreview'
import { GoStudioWebServerNotice } from './GoStudioWebServerNotice'
import { GoStudioPreviewSplit } from './GoStudioPreviewSplit'
import { selectSessionPreview, useLivePreviewStore } from '@/stores/livePreview'

interface GoStudioEditorProps {
  documents: GoIDEEditorDocument[]
  active: GoIDEEditorDocument | null
  onCursor: (line: number, column: number) => void
  onRequestClose: (documents: GoIDEEditorDocument[]) => void
  onRunTarget: GoStudioRunTargetHandler
}

export function GoStudioEditor({ documents, active, onCursor, onRequestClose, onRunTarget }: GoStudioEditorProps) {
  const [compare, setCompare] = useState(false)
  const [htmlModes, setHtmlModes] = useState<Record<string, GoStudioHtmlMode>>({})
  const theme = useGoStudioEditorTheme()
  const saveDocument = useGoIDEStore((state) => state.saveDocument)
  const resolveExternalChange = useGoIDEStore((state) => state.resolveExternalChange)
  const split = useGoIDEStore((state) => (state.activeSessionId ? state.splitBySession[state.activeSessionId] ?? null : null))
  const splitDocument = split ? documents.find((item) => item.document.id === split.documentId) ?? null : null
  const allDocuments = useGoIDEStore((state) => state.documents)
  const sessions = useGoIDEStore((state) => state.sessions)
  const activeSessionId = useGoIDEStore((state) => state.activeSessionId)
  // La preview vive nella sessione anche quando nessun file è aperto.
  const previewSessionId = active?.document.sessionId ?? activeSessionId ?? undefined
  const livePreview = useLivePreviewStore((state) => selectSessionPreview(state, previewSessionId))
  const previewSession = previewSessionId ? sessions.find((item) => item.id === previewSessionId) : undefined
  const previewInSplit = !!previewSession && livePreview.visible && livePreview.placement === 'split'
  const previewInTab = !!previewSession && livePreview.visible && livePreview.placement === 'tab'
  const previewTabShown = previewInTab && livePreview.tabActive
  const coverage = useGoIDETestsStore((state) => (active ? visibleCoverage(state, active.document.sessionId) : null))
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
  useGoStudioDocumentSymbols(active)

  useEffect(() => { setCompare(false) }, [active?.document.id])

  // Open In → Browser: forza la modalità preview del documento HTML appena aperto.
  const htmlPreviewRequest = useGoIDEStore((state) => state.htmlPreviewRequest)
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
          <GoStudioEditorTabs
            documents={documents} activeId="" onRequestClose={onRequestClose}
            previewTab={{ active: livePreview.tabActive, label: 'Live Preview', onSelect: () => useLivePreviewStore.getState().setTabActive(previewSession.id, true), onClose: () => useLivePreviewStore.getState().hide(previewSession.id) }}
            onSelectDocument={() => useLivePreviewStore.getState().setTabActive(previewSession.id, false)}
          />
          <div className="relative flex min-h-0 min-w-0 flex-1">{livePreview.tabActive ? <GoStudioLivePreview session={previewSession} embedded /> : empty}</div>
        </section>
      )
    }
    return <GoStudioPreviewSplit session={previewSession} open={previewInSplit} editor={empty} />
  }

  const main = (
    <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GoStudioEditorTabs
        documents={documents} activeId={active.document.id} onRequestClose={onRequestClose}
        actions={<GoStudioEditorTabActions document={active} onSave={() => void saveDocument(active.document.id)} />}
        previewTab={previewInTab ? { active: livePreview.tabActive, label: 'Live Preview', onSelect: () => useLivePreviewStore.getState().setTabActive(active.document.sessionId, true), onClose: () => useLivePreviewStore.getState().hide(active.document.sessionId) } : undefined}
        onSelectDocument={previewInTab ? () => useLivePreviewStore.getState().setTabActive(active.document.sessionId, false) : undefined}
      />
      <GoStudioWebServerNotice document={active} />
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
      <div data-go-studio-editor-host className={`relative min-h-0 flex-1 ${previewTabShown ? 'hidden' : ''}`}>
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
        ) : isImageDocument(active) ? (
          <GoStudioImageView document={active} />
        ) : isHtmlDocument(active) ? (
          <GoStudioHtmlView
            document={active}
            mode={htmlModes[active.document.id] ?? (previewInSplit || previewInTab ? 'editor' : 'split')}
            onModeChange={(mode) => setHtmlModes((modes) => ({ ...modes, [active.document.id]: mode }))}
            editor={<GoStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />}
          />
        ) : isMarkdownDocument(active) ? (
          <GoStudioMarkdownDocument
            document={active}
            editor={<GoStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />}
          />
        ) : (
          <>
            <GoStudioCodeEditor document={active} handlesReveal onCursor={onCursor} onRunTarget={onRunTarget} />
            <GoStudioInspectionWidget document={active} />
          </>
        )}
      </div>
      {previewTabShown && previewSession && <div className="relative flex min-h-0 min-w-0 flex-1"><GoStudioLivePreview session={previewSession} embedded /></div>}
    </section>
  )

  const body = !split || !splitDocument ? main : (
    <div className={`flex min-h-0 min-w-0 flex-1 ${split.orientation === 'right' ? 'flex-row' : 'flex-col'}`}>
      {main}
      <div className={split.orientation === 'right' ? 'w-px shrink-0 bg-border-1' : 'h-px shrink-0 bg-border-1'} />
      <GoStudioSplitPane documents={documents} document={splitDocument} onRunTarget={onRunTarget} onCursor={onCursor} />
    </div>
  )
  return <GoStudioPreviewSplit session={previewSession} open={previewInSplit} editor={body} />
}
