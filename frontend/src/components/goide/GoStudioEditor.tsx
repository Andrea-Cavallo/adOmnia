import { useEffect, useRef, useState } from 'react'
import Editor, { DiffEditor, type BeforeMount, type OnMount } from '@monaco-editor/react'
import { AlertTriangle, GitCompare, RotateCcw, Save, X } from 'lucide-react'
import { applyAdomniaMonacoTheme, configureMonacoLoader, monaco } from '@/lib/monacoSetup'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'
import { useSettingsStore } from '@/stores/settings'

configureMonacoLoader()

interface GoStudioEditorProps {
  documents: GoIDEEditorDocument[]
  active: GoIDEEditorDocument | null
  onCursor: (line: number, column: number) => void
  onRequestClose: (document: GoIDEEditorDocument) => void
}

export function GoStudioEditor({ documents, active, onCursor, onRequestClose }: GoStudioEditorProps) {
  const [compare, setCompare] = useState(false)
  const editorTheme = useSettingsStore((state) => state.settings.appearance.theme === 'light' ? 'adomnia-light' : 'adomnia-dark')
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const selectDocument = useGoIDEStore((state) => state.selectDocument)
  const updateDocument = useGoIDEStore((state) => state.updateDocument)
  const saveDocument = useGoIDEStore((state) => state.saveDocument)
  const resolveExternalChange = useGoIDEStore((state) => state.resolveExternalChange)
  const checkActiveDocument = useGoIDEStore((state) => state.checkActiveDocument)
  const revealLocation = useGoIDEStore((state) => state.revealLocation)
  const clearRevealLocation = useGoIDEStore((state) => state.clearRevealLocation)

  const beforeMount: BeforeMount = (instance) => applyAdomniaMonacoTheme(instance)
  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveDocument())
    editor.onDidChangeCursorPosition((event) => onCursor(event.position.lineNumber, event.position.column))
    editor.onDidFocusEditorText(() => void checkActiveDocument())
  }

  useEffect(() => {
    if (!active || revealLocation?.documentId !== active.document.id || !editorRef.current) return
    const position = { lineNumber: revealLocation.line, column: revealLocation.column }
    editorRef.current.setPosition(position)
    editorRef.current.revealPositionInCenter(position)
    editorRef.current.focus()
    clearRevealLocation()
  }, [active, clearRevealLocation, revealLocation])

  useEffect(() => { setCompare(false) }, [active?.document.id])

  if (!active) {
    return (
      <section aria-label="Editor" className="flex min-h-0 flex-1 items-center justify-center bg-surface-0">
        <div className="text-center text-[11px] text-text-4">
          <p className="font-medium text-text-3">Open a file from Project</p>
          <p className="mt-1">Quick Open: Ctrl/Cmd+P · Save: Ctrl/Cmd+S</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Editor" className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">
      <div className="flex h-8 shrink-0 overflow-x-auto border-b border-border-1 bg-surface-1">
        {documents.map((item) => (
          <button
            key={item.document.id}
            type="button"
            onClick={() => selectDocument(item.document.id)}
            className={`group flex h-8 min-w-0 max-w-56 items-center gap-1.5 border-r border-border-1 px-2 text-[10px] ${item.document.id === active.document.id ? 'border-t border-t-accent bg-surface-0 text-text-1' : 'text-text-3 hover:bg-surface-2'}`}
            title={item.document.relativePath}
          >
            <span className="truncate">{item.document.name}</span>
            {item.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Unsaved changes" />}
            <span role="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); onRequestClose(item) }} className="grid h-4 w-4 shrink-0 place-items-center rounded opacity-0 hover:bg-surface-3 group-hover:opacity-100"><X size={10} /></span>
          </button>
        ))}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border-1 px-2 text-[10px] text-text-4">
        {active.document.relativePath.split('/').map((segment, index) => <span key={`${segment}-${index}`}>{index > 0 && <span className="px-1 text-border-2">›</span>}{segment}</span>)}
        <button type="button" disabled={!active.dirty || active.saving} onClick={() => void saveDocument(active.document.id)} className="ml-auto flex h-5 items-center gap-1 rounded px-1.5 text-text-3 hover:bg-surface-2 hover:text-text-1 disabled:opacity-30"><Save size={10} /> Save</button>
      </div>
      {active.externalState && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
          <AlertTriangle size={12} /> This file changed on disk. Your buffer was preserved.
          <button type="button" onClick={() => resolveExternalChange(active.document.id, 'reload')} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-warning/10"><RotateCcw size={10} /> Reload</button>
          <button type="button" onClick={() => resolveExternalChange(active.document.id, 'keep')} className="rounded px-1.5 py-0.5 hover:bg-warning/10">Keep mine</button>
          <button type="button" onClick={() => setCompare((value) => !value)} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-warning/10"><GitCompare size={10} /> {compare ? 'Editor' : 'Compare'}</button>
        </div>
      )}
      {active.saveError && <div className="shrink-0 border-b border-danger/30 bg-danger/10 px-2 py-1 text-[10px] text-danger">{active.saveError}</div>}
      <div className="min-h-0 flex-1">
        {compare && active.externalState ? (
          <DiffEditor
            original={active.externalState.content ?? ''}
            modified={active.buffer}
            language={active.document.language}
            theme={editorTheme}
            beforeMount={beforeMount}
            options={{ automaticLayout: true, renderSideBySide: true, readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          />
        ) : (
          <Editor
            path={active.document.uri}
            language={active.document.language}
            value={active.buffer}
            theme={editorTheme}
            beforeMount={beforeMount}
            onMount={onMount}
            onChange={(value) => updateDocument(active.document.id, value ?? '')}
            options={{
              automaticLayout: true,
              fontSize: 12,
              fontFamily: 'var(--skin-font-mono, var(--font-mono))',
              lineHeight: 20,
              minimap: { enabled: false },
              lineNumbers: 'on',
              folding: true,
              bracketPairColorization: { enabled: true },
              matchBrackets: 'always',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              tabSize: active.document.language === 'go' ? 4 : 2,
              insertSpaces: active.document.language !== 'go',
              padding: { top: 6, bottom: 6 },
            }}
          />
        )}
      </div>
    </section>
  )
}
