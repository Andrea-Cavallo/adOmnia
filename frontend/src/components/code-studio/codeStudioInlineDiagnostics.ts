import { monaco } from '@/lib/monacoSetup'

/** One annotation per starting line; errors win over warnings and information. */
export function inlineDiagnosticDecorations(
  model: monaco.editor.ITextModel,
  markers: readonly monaco.editor.IMarker[],
  severities: readonly number[],
): monaco.editor.IModelDeltaDecoration[] {
  const lines = new Map<number, monaco.editor.IMarker[]>()
  for (const marker of markers) {
    if (!severities.includes(marker.severity) || marker.startLineNumber < 1 || marker.startLineNumber > model.getLineCount()) continue
    const group = lines.get(marker.startLineNumber) ?? []
    group.push(marker)
    lines.set(marker.startLineNumber, group)
  }
  return [...lines].map(([line, group]) => {
    group.sort((a, b) => b.severity - a.severity || a.startColumn - b.startColumn)
    const primary = group[0]
    const kind = primary.severity === monaco.MarkerSeverity.Error ? 'error' : primary.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'info'
    const column = model.getLineMaxColumn(line)
    const message = primary.message.replace(/\s+/g, ' ').trim()
    const summary = message.length > 180 ? `${message.slice(0, 177)}…` : message
    return {
      range: new monaco.Range(line, column, line, column),
      options: {
        isWholeLine: true,
        className: `code-studio-diagnostic-line-${kind}`,
        hoverMessage: group.map(marker => ({ value: `${marker.source ? `${marker.source}: ` : ''}${marker.message}`, isTrusted: false, supportHtml: false })),
        after: {
          content: `  ${summary}${group.length > 1 ? ` (+${group.length - 1})` : ''}`,
          inlineClassName: `code-studio-diagnostic-text code-studio-diagnostic-text-${kind}`,
          cursorStops: monaco.editor.InjectedTextCursorStops.None,
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    }
  })
}

/** Each editor (including splits) owns its decorations and subscriptions. */
export function installInlineDiagnostics(editor: monaco.editor.IStandaloneCodeEditor, severities: readonly number[]): () => void {
  const decorations = editor.createDecorationsCollection()
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    const model = editor.getModel()
    decorations.set(model ? inlineDiagnosticDecorations(model, monaco.editor.getModelMarkers({ resource: model.uri }), severities) : [])
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 100)
  }
  const markers = monaco.editor.onDidChangeMarkers(uris => {
    const uri = editor.getModel()?.uri.toString()
    if (uris.some(changed => changed.toString() === uri)) schedule()
  })
  const model = editor.onDidChangeModel(refresh)
  const content = editor.onDidChangeModelContent(schedule)
  refresh()
  return () => {
    clearTimeout(timer)
    markers.dispose()
    model.dispose()
    content.dispose()
    decorations.clear()
  }
}
