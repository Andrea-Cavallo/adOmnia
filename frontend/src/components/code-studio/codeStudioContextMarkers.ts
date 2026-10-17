import { useActivityPhase } from '@/hooks/useActivity'
import { useEffect, useRef, type MutableRefObject } from 'react'
import { monaco } from '@/lib/monacoSetup'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { analyzeContextPropagation, loadContextTimeoutThreshold, type ContextFinding, type ContextSeverity } from './codeStudioContextAnalysis'

const REFRESH_DEBOUNCE_MS = 700

const SEVERITY_GLYPH: Record<ContextSeverity, string> = {
  error: 'code-studio-ctx-glyph code-studio-ctx-error',
  warning: 'code-studio-ctx-glyph code-studio-ctx-warning',
  info: 'code-studio-ctx-glyph code-studio-ctx-info',
}

const SEVERITY_RANK: Record<ContextSeverity, number> = { error: 0, warning: 1, info: 2 }

/** Una decorazione per riga, con il problema più grave e l'elenco completo nel tooltip. */
export function contextMarkerDecorations(findings: readonly ContextFinding[]): monaco.editor.IModelDeltaDecoration[] {
  const byLine = new Map<number, ContextFinding[]>()
  for (const finding of findings) {
    const list = byLine.get(finding.line) ?? []
    list.push(finding)
    byLine.set(finding.line, list)
  }
  const decorations: monaco.editor.IModelDeltaDecoration[] = []
  for (const [line, list] of byLine) {
    const worst = [...list].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])[0]
    const messages = list.map((finding) => `• ${finding.message}`).join('\n')
    decorations.push({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: {
        glyphMarginClassName: SEVERITY_GLYPH[worst.severity],
        glyphMarginHoverMessage: { value: `**Context propagation**\n\n${messages}` },
      },
    })
  }
  return decorations
}

/** Marcatori nel gutter del file attivo: ricalcolati con debounce sul buffer, senza gopls. */
export function useCodeStudioContextMarkers(editorRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>, document: GoIDEEditorDocument, mountCount: number): void {
  const activityPhase = useActivityPhase(`goide:${document.document.sessionId}`)
  const collectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const { external, readOnly, relativePath } = document.document
  const enabled = relativePath.endsWith('.go') && !external && !readOnly

  useEffect(() => {
    const editor = editorRef.current
    if (editor) collectionRef.current ??= editor.createDecorationsCollection()
  }, [editorRef, mountCount])

  useEffect(() => {
    if (!enabled) {
      collectionRef.current?.clear()
      return
    }
    if (activityPhase !== 'Active') return
    const timer = window.setTimeout(() => {
      const analysis = analyzeContextPropagation(document.buffer, { timeoutThresholdMs: loadContextTimeoutThreshold() })
      collectionRef.current?.set(contextMarkerDecorations(analysis.findings))
    }, REFRESH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [document.buffer, enabled, mountCount, activityPhase])
}
