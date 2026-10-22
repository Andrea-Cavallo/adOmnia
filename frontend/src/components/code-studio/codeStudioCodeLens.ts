import { monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore, type GoIDEEditorDocument, type GoIDEQuickRunKind } from '@/stores/codeStudio'
import { packageLenses } from './codeStudioRunTargets'
import { documentForModel } from './codeStudioLanguageFeatures'
import { goModLenses, parseGoMod, type GoModLensAction } from './codeStudioGoMod'
import { runGoModQuickAction, runCodeStudioQuickCommand } from './codeStudioQuickActions'
import { openGoModDependencySource } from './codeStudioDependencySource'
import { findHttpRoutes } from './codeStudioHttpRoutes'
import { openRouteInApiClient } from './codeStudioIntegrations'
import { useDevContextStore } from '@/stores/devcontext'
import { entityRefFrom, type DevEntity } from '@/lib/devcontext-api'
import { actionsFor, openEntity } from '@/lib/entities/router'
import { runHandlerAction, type HandlerAction } from '@/lib/devsession/codeToApi'
import { ROUTE_INLINE_ACTIONS, runRouteEntityAction, runRouteInlineAction, type RouteInlineAction } from './codeStudioRouteActions'

const LANGUAGE = 'go'
/** Linguaggi i cui handler HTTP arrivano dal Developer Context (non da regex sul buffer). */
export const CONTEXT_ROUTE_LANGUAGES = ['java', 'python']
const ENTITY_ROUTE_ACTION_COMMAND = 'codeStudio.entityRouteAction'
const GO_MOD_COMMAND = 'codeStudio.goModAction'
const PACKAGE_COMMAND = 'codeStudio.packageCommand'
const HTTP_ROUTE_COMMAND = 'codeStudio.openHttpRoute'
const ENTITY_COMMAND = 'codeStudio.openEntity'
const HANDLER_COMMAND = 'codeStudio.handlerRequest'
const ROUTE_ACTION_COMMAND = 'codeStudio.routeAction'
const HANDLER_ACTIONS: Array<{ action: HandlerAction; title: (route: DevEntity) => string; tooltip: string }> = [
  { action: 'open', title: (route) => `⇄ ${route.label}`, tooltip: 'Open the linked request in the API workspace' },
  { action: 'send', title: () => 'Run', tooltip: 'Send the linked request to the running service' },
  { action: 'debug', title: () => 'Debug request', tooltip: 'Run the service under Delve, send the request and stop at breakpoints' },
  { action: 'last', title: () => 'Last response', tooltip: 'Show the last response of this route' },
  { action: 'history', title: () => 'History', tooltip: 'Open the request history' },
]
/** Code → DB / Kafka / gRPC / WebSocket: le route HTTP hanno già il loro lens, letto dal buffer. */
const LENS_KINDS = new Set(['table', 'topic', 'grpc', 'websocket'])
const lensEntities = new Map<string, DevEntity>()

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
  const packages = packageLenses(relativePath, text).map((lens) => ({
    range: lensRange(lens.line),
    command: { id: PACKAGE_COMMAND, title: lens.title, tooltip: lens.tooltip, arguments: [id, lens.kind] },
  }))
  if (relativePath.endsWith('_test.go')) return packages
  const routes = findHttpRoutes(text).flatMap((route) => [
    { range: lensRange(route.line), command: { id: HTTP_ROUTE_COMMAND, title: `Open ${route.method} ${route.path} in API Client`, tooltip: 'Creates a prefilled request in the adOmnia API client', arguments: [id, route.line] } },
    ...ROUTE_INLINE_ACTIONS.map((item) => ({ range: lensRange(route.line), command: { id: ROUTE_ACTION_COMMAND, title: item.title, tooltip: item.tooltip, arguments: [id, route.line, item.action] } })),
  ])
  return [...packages, ...routes, ...entityLenses(document), ...handlerLenses(document)]
}

/** Entità del Developer Context trovate in questo file (scansione su disco: le righe seguono l'ultimo salvataggio). */
function entityLenses(document: GoIDEEditorDocument): monaco.languages.CodeLens[] {
  const { sessionId, relativePath } = document.document
  const snapshot = useDevContextStore.getState().snapshots[sessionId]
  if (!snapshot) {
    void useDevContextStore.getState().ensure(sessionId)
    return []
  }
  const lenses: monaco.languages.CodeLens[] = []
  for (const entity of snapshot.entities ?? []) {
    if (!LENS_KINDS.has(entity.kind)) continue
    const ref = entityRefFrom(entity, sessionId)
    const action = actionsFor(ref).find((item) => item.isDefault)
    if (!action) continue
    for (const source of entity.sources ?? []) {
      if (source.file !== relativePath) continue
      lensEntities.set(entity.id, entity)
      lenses.push({
        range: lensRange(source.line),
        command: { id: ENTITY_COMMAND, title: `${action.title}: ${entity.label}`, tooltip: `Opens ${entity.label} in adOmnia`, arguments: [sessionId, entity.id, source.line] },
      })
    }
  }
  return lenses
}

/** Code → API: sulla dichiarazione di un handler, le azioni sulla request che lo esercita. `debug` è solo Go (Delve). */
function handlerLenses(document: GoIDEEditorDocument, withInline = false): monaco.languages.CodeLens[] {
  const { sessionId, relativePath } = document.document
  const snapshot = useDevContextStore.getState().snapshots[sessionId]
  if (!snapshot) {
    if (withInline) void useDevContextStore.getState().ensure(sessionId)
    return []
  }
  const lenses: monaco.languages.CodeLens[] = []
  for (const route of snapshot.entities ?? []) {
    if (route.kind !== 'route' || route.attrs.declFile !== relativePath) continue
    const line = Number(route.attrs.declLine)
    if (!line) continue
    lensEntities.set(route.id, route)
    for (const item of HANDLER_ACTIONS) {
      if (withInline && item.action === 'debug') continue
      lenses.push({ range: lensRange(line), command: { id: HANDLER_COMMAND, title: item.title(route), tooltip: item.tooltip, arguments: [sessionId, route.id, item.action] } })
    }
    if (withInline) {
      for (const item of ROUTE_INLINE_ACTIONS) lenses.push({ range: lensRange(line), command: { id: ENTITY_ROUTE_ACTION_COMMAND, title: item.title, tooltip: item.tooltip, arguments: [sessionId, route.id, item.action] } })
    }
  }
  return lenses
}

/** Apre la route della riga come richiesta API, rileggendo il buffer attuale del documento. */
export function openHttpRouteAt(document: GoIDEEditorDocument, line: number): boolean {
  const route = findHttpRoutes(document.buffer).find((item) => item.line === line)
  if (!route) return false
  openRouteInApiClient(route, document.buffer, `${document.document.relativePath}:${line}`)
  return true
}

function editableDocument(documentId: string): GoIDEEditorDocument | null {
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
  return document && !document.document.readOnly ? document : null
}

/** Registra i CodeLens di go.mod e della riga package, una sola volta per processo. */
export function registerCodeStudioCodeLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(GO_MOD_COMMAND, (_accessor, documentId: string, action: GoModLensAction, modulePath: string) => {
    const document = editableDocument(documentId)
    if (!document) return
    // View code e Browse files aprono il sorgente della dipendenza, non modificano il go.mod.
    if (action === 'viewcode' || action === 'browse') void openGoModDependencySource(document, modulePath, action === 'browse')
    else void runGoModQuickAction(document, action, modulePath)
  })
  monaco.editor.registerCommand(PACKAGE_COMMAND, (_accessor, documentId: string, kind: GoIDEQuickRunKind) => {
    const document = editableDocument(documentId)
    if (document) void runCodeStudioQuickCommand(kind, 'package', document)
  })
  monaco.editor.registerCommand(HTTP_ROUTE_COMMAND, (_accessor, documentId: string, line: number) => {
    const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
    if (document) openHttpRouteAt(document, line)
  })
  monaco.editor.registerCommand(ROUTE_ACTION_COMMAND, (_accessor, documentId: string, line: number, action: RouteInlineAction) => {
    const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
    if (document) void runRouteInlineAction(document, line, action)
  })
  monaco.editor.registerCommand(ENTITY_COMMAND, (_accessor, sessionId: string, entityId: string, line: number) => {
    const entity = lensEntities.get(entityId)
    if (!entity) return
    const ref = entityRefFrom(entity, sessionId)
    void openEntity({ ...ref, source: ref.source && { ...ref.source, line } })
  })
  monaco.editor.registerCommand(ENTITY_ROUTE_ACTION_COMMAND, (_accessor, sessionId: string, routeId: string, action: RouteInlineAction) => {
    const route = lensEntities.get(routeId)
    if (route) void runRouteEntityAction(sessionId, route, action)
  })
  monaco.editor.registerCommand(HANDLER_COMMAND, (_accessor, sessionId: string, routeId: string, action: HandlerAction) => {
    const route = lensEntities.get(routeId)
    if (route) void runHandlerAction(sessionId, route, action)
  })
  // I lens si aggiornano quando arriva o cambia lo snapshot del Developer Context.
  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  useDevContextStore.subscribe((state, previous) => { if (state.snapshots !== previous.snapshots) changed.fire(provider) })
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || document.document.external) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(document, model.getValue()), dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
  monaco.languages.registerCodeLensProvider(CONTEXT_ROUTE_LANGUAGES, {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || document.document.external) return { lenses: [], dispose: () => undefined }
      return { lenses: handlerLenses(document, true), dispose: () => undefined }
    },
  })
}
