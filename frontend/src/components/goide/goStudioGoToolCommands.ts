import type { GoIDEGoTool, GoIDESession } from '@/lib/goide-api'
import { activeGoIDEDocument, useGoIDEStore } from '@/stores/goide'
import type { GoStudioCommandId } from './goStudioCommands'
import { expressionAt } from './goStudioDebugEditor'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { defaultGoToolTarget } from './goStudioGoTools'
import type { GoStudioGoToolDialogState } from './GoStudioGoToolDialog'
import { moduleScopeFor } from './goStudioQuickActions'

const TOOL_COMMANDS: Partial<Record<GoStudioCommandId, GoIDEGoTool>> = {
  'go.toolVet': 'vet',
  'go.toolGenerate': 'generate',
  'go.toolFix': 'fix',
  'go.toolModWhy': 'modWhy',
  'go.toolModGraph': 'modGraph',
  'go.toolDoc': 'doc',
}

/** Selezione su una riga, altrimenti l'identificatore (con selettore) sotto il cursore. */
function wordAtCaret(): { word: string; lineText: string } {
  const editor = activeGoStudioEditor()
  const model = editor?.getModel()
  const position = editor?.getPosition()
  if (!editor || !model || !position) return { word: '', lineText: '' }
  const lineText = model.getLineContent(position.lineNumber)
  const selection = editor.getSelection()
  const selected = selection && !selection.isEmpty() ? model.getValueInRange(selection).trim() : ''
  if (selected && !selected.includes('\n')) return { word: selected, lineText }
  return { word: expressionAt(lineText, position.column) ?? '', lineText }
}

/** Stato iniziale del dialog Go Tools per il comando di menu, o null se il comando non è di Go Tools. */
export function goToolDialogFor(id: GoStudioCommandId, session: GoIDESession | null): GoStudioGoToolDialogState | null {
  const tool = TOOL_COMMANDS[id]
  if (!tool || !session) return null
  const document = activeGoIDEDocument(useGoIDEStore.getState())
  const relativePath = document && !document.document.external && document.document.sessionId === session.id ? document.document.relativePath : null
  const scope = moduleScopeFor(session, relativePath)
  const { word, lineText } = wordAtCaret()
  return { tool, workingDirectory: scope.moduleDirectory, target: defaultGoToolTarget(tool, { packageTarget: scope.packageTarget, word, lineText }) }
}
