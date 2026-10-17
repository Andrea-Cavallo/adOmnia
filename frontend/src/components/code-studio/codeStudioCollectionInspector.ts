import type { CodeStudioDebugValueKind } from './codeStudioDebugValueInspector'

export function codeStudioCollectionExpressions(kind: CodeStudioDebugValueKind, expression: string): Array<{ label: 'Len' | 'Cap'; expression: string }> {
  if (kind === 'slice' || kind === 'channel') return [{ label: 'Len', expression: `len(${expression})` }, { label: 'Cap', expression: `cap(${expression})` }]
  if (kind === 'map') return [{ label: 'Len', expression: `len(${expression})` }]
  return []
}
