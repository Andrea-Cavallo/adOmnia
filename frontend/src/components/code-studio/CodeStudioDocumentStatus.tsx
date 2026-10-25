import { useShallow } from 'zustand/react/shallow'
import { useEffect, useState } from 'react'
import { useCodeStudioStore, activeGoIDEDocument } from '@/stores/codeStudio'
import { runCodeStudioEditorCommand } from './codeStudioEditorRegistry'
import { isImageDocument } from './CodeStudioImageView'
import { useCodeStudioCursorStore } from './codeStudioCursor'

const CONTROL = 'h-5 max-w-28 rounded border-0 bg-surface-1 px-1 text-[11px] text-text-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent'

export function CodeStudioDocumentStatus() {
  const cursor = useCodeStudioCursorStore(useShallow(state=>({line:state.line,column:state.column})))
  const [languages, setLanguages] = useState<{ id: string; aliases?: string[] }[]>([])
  useEffect(() => {
    let cancelled = false
    void import('@/lib/monacoSetup').then(({ monaco }) => {
      if (!cancelled) setLanguages(monaco.languages.getLanguages())
    })
    return () => { cancelled = true }
  }, [])
  const document = useCodeStudioStore(useShallow((state) => {
    const active = activeGoIDEDocument(state)
    return active ? { id: active.document.id, uri: active.document.uri, sessionId: active.document.sessionId, image: isImageDocument(active), language: active.document.language, readOnly: active.document.readOnly, lineEnding: active.buffer.includes('\r\n') ? 'CRLF' : 'LF' } : null
  }))
  if (!document) return null
  if (document.image) return <span className="px-1 text-text-3">Image · read-only</span>
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label="Document settings">
      <select aria-label="Line ending" title={document.readOnly ? 'Read-only document' : 'Convert line endings (saved with the document)'} disabled={document.readOnly} value={document.lineEnding} className={CONTROL} onChange={async (event) => {
        const ending = event.currentTarget.value
        const { monaco } = await import('@/lib/monacoSetup')
        const model = monaco.editor.getModel(monaco.Uri.parse(document.uri).with({ fragment: `session=${document.sessionId}` }))
        if (!model || activeGoIDEDocument(useCodeStudioStore.getState())?.document.id !== document.id) return
        model.pushStackElement()
        model.pushEOL(ending === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
        model.pushStackElement()
        useCodeStudioStore.getState().updateDocument(document.id, model.getValue())
      }}>
        <option value="LF">LF</option><option value="CRLF">CRLF</option>
      </select>
      <button type="button" title="Go to line or column" aria-label="Go to line or column" onClick={async () => {
        const { monaco } = await import('@/lib/monacoSetup')
        if (activeGoIDEDocument(useCodeStudioStore.getState())?.document.id !== document.id) return
        runCodeStudioEditorCommand('edit.gotoLine', monaco.Uri.parse(document.uri).with({ fragment: `session=${document.sessionId}` }).toString())
      }} className={`${CONTROL} tabular-nums hover:bg-surface-3`}>{cursor.line}:{cursor.column}</button>
      <span title="Code Studio reads and saves text as UTF-8; other encodings are not supported" className="px-1 text-text-3">UTF-8</span>
      <select aria-label="Editor language" title="Editor language mode" value={document.language} className={CONTROL} onChange={async (event) => {
        const language = event.currentTarget.value
        const { monaco } = await import('@/lib/monacoSetup')
        const model = monaco.editor.getModel(monaco.Uri.parse(document.uri).with({ fragment: `session=${document.sessionId}` }))
        if (!model || activeGoIDEDocument(useCodeStudioStore.getState())?.document.id !== document.id) return
        monaco.editor.setModelLanguage(model, language)
        useCodeStudioStore.setState((state) => ({ documents: state.documents.map((item) => item.document.id === document.id ? { ...item, document: { ...item.document, language } } : item) }))
      }}>
        {!languages.some((item) => item.id === document.language) && <option value={document.language}>{document.language}</option>}
        {languages.map((item) => <option key={item.id} value={item.id}>{item.aliases?.[0] ?? item.id}</option>)}
      </select>
    </div>
  )
}
