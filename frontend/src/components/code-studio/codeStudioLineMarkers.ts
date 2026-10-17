import { useEffect, useRef, type MutableRefObject } from 'react'
import type { monaco } from '@/lib/monacoSetup'

const TRACK_DEBOUNCE_MS = 400

interface TrackedLineMarkers {
  /** Cambia quando cambia il documento mostrato: le decorazioni vanno ridisegnate sul nuovo modello. */
  documentId: string
  mountCount: number
  /** Decorazioni correnti (memoizzate dal chiamante). */
  decorations: monaco.editor.IModelDeltaDecoration[]
  /** false per i documenti che non accettano marcatori: nessun tracciamento delle modifiche. */
  tracked: boolean
  /** Righe dei marcatori dopo una modifica del testo, a scrittura ferma. */
  onMoved: (lines: number[]) => void
}

/**
 * Marcatori di riga (breakpoint, segnalibri) che seguono il codice mentre si scrive:
 * Monaco sposta le decorazioni con il testo e, dopo una pausa, le nuove righe tornano al proprietario.
 */
export function useTrackedLineMarkers(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, markers: TrackedLineMarkers): void {
  const { documentId, mountCount, decorations, tracked } = markers
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const onMoved = useRef(markers.onMoved)
  onMoved.current = markers.onMoved

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    collectionRef.current?.set(decorations)
  }, [decorations, documentId, mountCount])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !tracked) return
    let timer = 0
    const subscription = editor.onDidChangeModelContent(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const collection = collectionRef.current
        if (collection) onMoved.current(collection.getRanges().map((range) => range.startLineNumber))
      }, TRACK_DEBOUNCE_MS)
    })
    return () => { window.clearTimeout(timer); subscription.dispose() }
  }, [documentId, editorRef, mountCount, tracked])
}
