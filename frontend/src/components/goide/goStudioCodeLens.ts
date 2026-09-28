import { monaco } from '@/lib/monacoSetup'
import { useGoIDEStore, type GoIDEEditorDocument, type GoIDEQuickRunKind } from '@/stores/goide'
import { packageLenses } from './goStudioRunTargets'
import { documentForModel } from './goStudioLanguageFeatures'
import { goModLenses, parseGoMod, type GoModDependencyAction } from './goStudioGoMod'
import { runGoModQuickAction, runGoStudioQuickCommand } from './goStudioQuickActions'

const LANGUAGE = 'go'
const GO_MOD_COMMAND = 'goStudio.goModAction'
const PACKAGE_COMMAND = 'goStudio.packageCommand'

let registered = false

function fileName(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath
}

function lensRange(line: number): monaco.IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

function lensesFor(document: GoIDEEditorDocument, text: string): monaco.languages.CodeLens[] {
  const { relativePath, id } = document.document
  if (fileName(relativePath) === 'go.mod') {
    return goModLenses(parseGoMod(text)).map((lens) => ({
      range: lensRange(lens.line),
      command: { id: GO_MOD_COMMAND, title: lens.title, tooltip: lens.tooltip, arguments: [id, lens.action, lens.modulePath ?? ''] },
    }))
  }
  return packageLenses(relativePath, text).map((lens) => ({
    range: lensRange(lens.line),
    command: { id: PACKAGE_COMMAND, title: lens.title, tooltip: lens.tooltip, arguments: [id, lens.kind] },
  }))
}

function editableDocument(documentId: string): GoIDEEditorDocument | null {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
  return document && !document.document.readOnly ? document : null
}

/** Registra i CodeLens di go.mod e della riga package, una sola volta per processo. */
export function registerGoStudioCodeLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(GO_MOD_COMMAND, (_accessor, documentId: string, action: GoModDependencyAction, modulePath: string) => {
    const document = editableDocument(documentId)
    if (document) void runGoModQuickAction(document, action, modulePath)
  })
  monaco.editor.registerCommand(PACKAGE_COMMAND, (_accessor, documentId: string, kind: GoIDEQuickRunKind) => {
    const document = editableDocument(documentId)
    if (document) void runGoStudioQuickCommand(kind, 'package', document)
  })
  monaco.languages.registerCodeLensProvider(LANGUAGE, {
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || document.document.external) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(document, model.getValue()), dispose: () => undefined }
    },
  })
}
