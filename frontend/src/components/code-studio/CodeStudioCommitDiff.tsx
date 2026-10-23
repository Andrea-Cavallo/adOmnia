import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { ArrowRight, ChevronDown, ChevronUp, Columns2, Loader2, Rows2, Undo2, UnfoldVertical } from 'lucide-react'
import type { monaco } from '@/lib/monacoSetup'
import * as GoIDEBindings from '../../../bindings/adomnia/goide'
import type { VCSWorkingDiff } from '../../../bindings/adomnia/internal/codestudio/models'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { useCodeStudioVCSStore } from '@/stores/codeStudioVcs'
import { lineChangeRange, revertLineChange, type DiffLineChange } from '@/lib/code-studio/lineChange'
import { beforeCodeStudioMount, useCodeStudioEditorTheme } from './CodeStudioCodeEditor'
import { applyCodeStudioHunkToIndex } from './codeStudioVcsHunkStage'

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  go: 'go', mod: 'go', sum: 'plaintext', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', css: 'css', html: 'html', xml: 'xml', sql: 'sql', sh: 'shell', proto: 'proto', toml: 'ini', dockerfile: 'dockerfile',
}

function languageOf(relativePath: string): string {
  const name = relativePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  return LANGUAGE_BY_EXTENSION[name.split('.').pop() ?? ''] ?? 'plaintext'
}

const PILL_WIDTH = 44
const PILL_HEIGHT = 22

interface ChangeMark {
  change: DiffLineChange
  top: number
}

function ToolbarButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3 hover:text-text-1 disabled:opacity-40">{children}</button>
}

/**
 * Diff del file scelto nel dialog di commit: HEAD a sinistra, la copia di lavoro a destra.
 * Tra i due editor una colonna di azioni per blocco: "Stage" porta il blocco sull'index,
 * "Revert" lo riporta com'è in HEAD. Nessuna freccia verso HEAD, che è immutabile.
 * Un buffer aperto e non salvato vince sul disco, perché il commit salva gli editor prima di registrare.
 */
export function CodeStudioCommitDiff({ sessionId, relativePath }: { sessionId: string; relativePath: string | null }) {
  const theme = useCodeStudioEditorTheme()
  const [diff, setDiff] = useState<VCSWorkingDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [version, setVersion] = useState(0)
  const [marks, setMarks] = useState<ChangeMark[]>([])
  const [active, setActive] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [pendingRevert, setPendingRevert] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const changesRef = useRef<DiffLineChange[]>([])
  const rootPath = useCodeStudioStore((state) => state.sessions.find((session) => session.id === sessionId)?.project.rootPath ?? '')
  const buffer = useCodeStudioStore((state) => (relativePath ? state.documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === relativePath && item.dirty)?.buffer : undefined))

  useEffect(() => {
    if (!relativePath) return
    let cancelled = false
    setDiff(null)
    setError(null)
    setNotice(null)
    setPendingRevert(null)
    GoIDEBindings.VCSWorkingDiff(sessionId, relativePath)
      .then((value) => { if (!cancelled) setDiff(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [sessionId, relativePath, version])

  /** Posizione di ogni blocco rispetto al contenitore: segue lo scroll e i cambi di layout dell'editor. */
  const place = useCallback(() => {
    const diffEditor = editorRef.current
    const box = boxRef.current
    if (!diffEditor || !box) return
    const modified = diffEditor.getModifiedEditor()
    const origin = modified.getDomNode()?.getBoundingClientRect().top ?? 0
    const offset = origin - box.getBoundingClientRect().top - modified.getScrollTop()
    const changes = (diffEditor.getLineChanges() ?? []) as DiffLineChange[]
    changesRef.current = changes
    setMarks(changes.map((change) => {
      const line = change.modifiedEndLineNumber === 0 ? change.modifiedStartLineNumber + 1 : change.modifiedStartLineNumber
      return { change, top: modified.getTopForLineNumber(Math.max(1, line)) + offset }
    }))
  }, [])

  const mountEditor = (diffEditor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = diffEditor
    const modified = diffEditor.getModifiedEditor()
    const original = diffEditor.getOriginalEditor()
    modified.updateOptions({ glyphMargin: true })
    const hover = (editor: monaco.editor.ICodeEditor, side: 'original' | 'modified') => editor.onMouseMove((event) => {
      const line = event.target.position?.lineNumber
      if (!line) return setHovered(null)
      const index = changesRef.current.findIndex((change) => side === 'modified'
        ? change.modifiedEndLineNumber !== 0 && line >= change.modifiedStartLineNumber && line <= change.modifiedEndLineNumber
        : change.originalEndLineNumber !== 0 && line >= change.originalStartLineNumber && line <= change.originalEndLineNumber)
      setHovered(index < 0 ? null : index)
    })
    hover(modified, 'modified')
    hover(original, 'original')
    modified.onDidScrollChange(place)
    modified.onDidLayoutChange(place)
    diffEditor.onDidUpdateDiff(place)
    place()
  }

  if (!relativePath) return <div className="grid h-full place-items-center text-[12px] text-text-4">Select a file to see its changes.</div>
  const modifiedText = buffer ?? diff?.modified ?? ''
  const name = relativePath.split('/').pop() ?? relativePath
  const folder = relativePath.slice(0, relativePath.length - name.length).replace(/\/$/, '')
  const count = changesRef.current.length

  const goTo = (step: 1 | -1) => {
    const changes = changesRef.current
    if (!changes.length) return
    const next = (active + step + changes.length) % changes.length
    const target = changes[next]
    setActive(next)
    editorRef.current?.getModifiedEditor().revealLineInCenter(Math.max(1, target.modifiedStartLineNumber))
  }

  const refresh = () => {
    setVersion((value) => value + 1)
    void useCodeStudioVCSStore.getState().refreshStatus(sessionId)
  }

  const report = (text: string, failed = false) => setNotice({ text, failed })

  const stage = async (change: DiffLineChange) => {
    setBusy(true)
    try {
      const dirty = useCodeStudioStore.getState().documents.find((item) => item.document.sessionId === sessionId && item.document.relativePath === relativePath && item.dirty)
      if (dirty && !await useCodeStudioStore.getState().saveDocument(dirty.document.id)) throw new Error('save the file first: it has unsaved changes that could not be written')
      const staged = await applyCodeStudioHunkToIndex(sessionId, `${rootPath.replace(/(^|[^\\/])[\\/]+$/, '$1')}/${relativePath}`, lineChangeRange(change), 'stage')
      const text = staged > 0 ? `Staged ${staged} change block${staged === 1 ? '' : 's'} of ${name}.` : `Nothing to stage in ${name}: this block is already in the index.`
      useCodeStudioLspStore.setState({ message: text })
      report(text)
      void useCodeStudioVCSStore.getState().refreshStatus(sessionId)
    } catch (reason) {
      report(reason instanceof Error ? reason.message : String(reason), true)
    } finally {
      setBusy(false)
    }
  }

  const revert = async (index: number) => {
    if (!diff) return
    if (pendingRevert !== index) return setPendingRevert(index)
    setPendingRevert(null)
    setBusy(true)
    try {
      const store = useCodeStudioStore.getState()
      const documentId = await store.openDocument(relativePath)
      if (!documentId) throw new Error('could not open the file to revert it')
      store.updateDocument(documentId, revertLineChange(modifiedText, diff.original, marks[index].change))
      if (!await useCodeStudioStore.getState().saveDocument(documentId)) throw new Error('the reverted file could not be saved')
      report(`Reverted the block to HEAD in ${name}.`)
      refresh()
    } catch (reason) {
      report(reason instanceof Error ? reason.message : String(reason), true)
    } finally {
      setBusy(false)
    }
  }

  const pillLeft = (() => {
    const diffEditor = editorRef.current
    const box = boxRef.current
    const modified = diffEditor?.getModifiedEditor().getDomNode()
    if (!modified || !box) return 0
    const left = modified.getBoundingClientRect().left - box.getBoundingClientRect().left
    return sideBySide ? left - PILL_WIDTH / 2 : left + 2
  })()

  return (
    <div className="code-studio-commit-diff flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-1 px-3 text-[12px]">
        <span className="min-w-0 truncate" title={relativePath}>
          <span className="font-medium text-text-1">{name}</span>
          {folder && <span className="ml-2 font-mono text-[11px] text-text-4">{folder}</span>}
        </span>
        {buffer !== undefined && <span className="gs-badge h-[16px] text-[10px] text-warning" title="The editor has unsaved changes: they are saved and included when you commit">unsaved</span>}
        {notice && <span role={notice.failed ? 'alert' : 'status'} className={`min-w-0 truncate text-[11.5px] ${notice.failed ? 'text-danger' : 'text-success'}`} title={notice.text}>{notice.text}</span>}
        <span className="ml-auto shrink-0 text-text-4">HEAD → working tree</span>
        <span className="flex shrink-0 items-center gap-0.5 border-l border-border-1 pl-2">
          <ToolbarButton label="Previous change" onClick={() => goTo(-1)} disabled={count === 0}><ChevronUp size={14} /></ToolbarButton>
          <span className="min-w-[34px] text-center text-[11.5px] tabular-nums text-text-3">{count ? `${Math.min(active + 1, count)} / ${count}` : '0'}</span>
          <ToolbarButton label="Next change" onClick={() => goTo(1)} disabled={count === 0}><ChevronDown size={14} /></ToolbarButton>
          <ToolbarButton label={expanded ? 'Collapse unchanged lines' : 'Expand all unchanged lines'} onClick={() => setExpanded((value) => !value)}><UnfoldVertical size={13} className={expanded ? 'text-accent' : undefined} /></ToolbarButton>
          <ToolbarButton label={sideBySide ? 'Unified view' : 'Side-by-side view'} onClick={() => setSideBySide((value) => !value)}>{sideBySide ? <Rows2 size={13} /> : <Columns2 size={13} />}</ToolbarButton>
        </span>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        {error && <p className="p-3 text-[12px] text-danger">{error}</p>}
        {!error && !diff && <div className="grid h-full place-items-center"><Loader2 size={16} className="animate-spin text-text-4" aria-label="Loading diff" /></div>}
        {diff?.binary && <p className="p-3 text-[12px] text-text-3">Binary file: its content is committed as is.</p>}
        {diff?.tooLarge && <p className="p-3 text-[12px] text-text-3">The file is too large to show a diff here; open it in the editor to review it.</p>}
        {diff && !diff.binary && !diff.tooLarge && (
          <>
            <DiffEditor
              original={diff.original}
              modified={modifiedText}
              language={languageOf(relativePath)}
              theme={theme}
              beforeMount={beforeCodeStudioMount}
              onMount={mountEditor}
              originalModelPath={`inmemory://commit/head/${relativePath}`}
              modifiedModelPath={`inmemory://commit/working/${relativePath}`}
              options={{ automaticLayout: true, renderSideBySide: sideBySide, readOnly: true, originalEditable: false, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false, renderOverviewRuler: true, hideUnchangedRegions: { enabled: !expanded, contextLineCount: 3, minimumLineCount: 6 } }}
            />
            <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-label="Change actions">
              {marks.map((mark, index) => (
                <div key={`${mark.change.modifiedStartLineNumber}:${mark.change.originalStartLineNumber}`} className={`pointer-events-auto absolute flex items-center justify-center gap-0.5 rounded-md border border-border-2 bg-surface-2 shadow-md transition-opacity ${hovered === index || active === index || pendingRevert === index ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
                  style={{ top: mark.top + 1, left: pillLeft, width: pendingRevert === index ? 'auto' : PILL_WIDTH, height: PILL_HEIGHT, display: mark.top < -PILL_HEIGHT ? 'none' : undefined }}>
                  <button type="button" disabled={busy} title="Stage this block (add it to the next commit's index)" aria-label="Stage this block" onClick={() => void stage(mark.change)} className="grid h-[18px] w-[18px] place-items-center rounded text-text-2 hover:bg-accent/20 hover:text-accent disabled:opacity-40"><ArrowRight size={12} /></button>
                  <button type="button" disabled={busy} title={pendingRevert === index ? 'Click again to discard this block of the working copy' : 'Revert this block to HEAD'} aria-label="Revert this block to HEAD" onClick={() => void revert(index)} className={`grid h-[18px] place-items-center rounded px-0.5 hover:bg-danger/20 hover:text-danger disabled:opacity-40 ${pendingRevert === index ? 'gap-1 bg-danger/20 text-danger' : 'w-[18px] text-text-2'}`}>
                    <Undo2 size={12} />{pendingRevert === index && <span className="text-[10.5px]">Confirm</span>}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
