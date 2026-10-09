import { monaco } from '@/lib/monacoSetup'
import { useGoIDEStore } from '@/stores/goide'
import { handoffToPanel } from '@/lib/entities/dispatch'
import { architectureFor, cachedArchitecture } from '@/lib/goide/architectureCache'
import { ancestorDirs, findProtoType, goHandlerFor, importCandidates, protocArguments, protoDeclarations, protoImports, protoRpcs, type ProtoRpc } from '@/lib/goide/protoLinks'
import { detectGoIDEGoTool, installGoIDEGoModule, runGoIDEGoTool } from '@/lib/goide-api'
import { showEntityNotice } from '@/lib/entities/notice'
import { confirm } from '@/lib/confirmDialog'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { readDevContextFile } from '@/lib/devcontext-api'
import { documentForModel, rememberLocations } from './goStudioLanguageFeatures'
import { openArchSite } from './GoStudioInterfaceExplorer'

// .proto → Go: on every rpc, the Go method that serves it, Debug and a call in the gRPC client.
const LANGUAGE = 'proto'
const HANDLER_COMMAND = 'goStudio.protoHandler'
const CALL_COMMAND = 'goStudio.protoCall'
const DEBUG_COMMAND = 'goStudio.protoDebug'
const LINK_COMMAND = 'goStudio.protoLink'
const GENERATE_COMMAND = 'goStudio.protoGenerate'
const PLUGINS = {
  go: { binary: 'protoc-gen-go', module: 'google.golang.org/protobuf/cmd/protoc-gen-go@latest' },
  grpc: { binary: 'protoc-gen-go-grpc', module: 'google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest' },
}

let registered = false
const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()

function lens(line: number, id: string, title: string, tooltip: string, args: unknown[]): monaco.languages.CodeLens {
  return { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, command: { id, title, tooltip, arguments: args } }
}

function lensesFor(sessionId: string, documentId: string, text: string): monaco.languages.CodeLens[] {
  const syntaxLine = text.split('\n').findIndex((line) => /^\s*(syntax|edition)\s*=/.test(line)) + 1
  const generate = lens(syntaxLine || 1, GENERATE_COMMAND, 'Generate Go code', 'buf generate when the module has buf.gen.yaml, otherwise protoc with protoc-gen-go (and protoc-gen-go-grpc for services)', [documentId])
  const rpcs = protoRpcs(text)
  if (!rpcs.length) return [generate]
  const report = cachedArchitecture(sessionId)?.report
  const out: monaco.languages.CodeLens[] = [generate]
  if (!report) out.push(lens(rpcs[0].line, LINK_COMMAND, 'Link rpcs to Go handlers', 'Analyze the project (nothing runs) to find the Go method serving each rpc', [sessionId]))
  for (const rpc of rpcs) {
    const handler = report ? goHandlerFor(report, rpc.service, rpc.method) : null
    if (handler) {
      out.push(lens(rpc.line, HANDLER_COMMAND, `→ ${handler.name}`, `${handler.site.relativePath}:${handler.site.line}`, [sessionId, rpc.service, rpc.method]))
      out.push(lens(rpc.line, DEBUG_COMMAND, 'Debug', 'Breakpoint in the Go handler, run under Delve, then call the rpc from the gRPC client', [sessionId, documentId, rpc.service, rpc.method]))
    } else if (report) {
      out.push(lens(rpc.line, HANDLER_COMMAND, 'No Go handler', 'No RegisterXServer type implements this rpc in this project', [sessionId, rpc.service, rpc.method]))
    }
    out.push(lens(rpc.line, CALL_COMMAND, 'Call in gRPC client', 'Load this .proto in the gRPC client with the rpc selected', [documentId, rpc.service, rpc.method]))
  }
  return out
}

function handlerOf(sessionId: string, service: string, method: string) {
  const report = cachedArchitecture(sessionId)?.report
  return report ? goHandlerFor(report, service, method) : null
}

function callInClient(documentId: string, rpc: Pick<ProtoRpc, 'service' | 'method'>, address?: string): void {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
  if (!document) return
  const name = document.document.relativePath.split('/').pop() ?? 'contract.proto'
  handoffToPanel('grpc', { kind: 'contract', id: `proto:${document.document.relativePath}`, label: name, attrs: { type: 'proto', path: document.document.relativePath } }, 'open',
    { text: document.buffer, name, service: rpc.service, method: rpc.method, ...(address ? { address } : {}) })
}

/** The port the debugged service listens on, once the live session has detected it (up to 10 s). */
async function livePort(liveId: string): Promise<number | undefined> {
  const { useDevSessionStore } = await import('@/stores/devSession')
  for (let i = 0; i < 40; i++) {
    const port = useDevSessionStore.getState().sessions[liveId]?.port
    if (port) return port
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return undefined
}

const SYMBOL_KIND = { message: monaco.languages.SymbolKind.Struct, enum: monaco.languages.SymbolKind.Enum, service: monaco.languages.SymbolKind.Interface, rpc: monaco.languages.SymbolKind.Method }

/** Outline: message, enum, service and rpc, nested under their parent. */
function protoSymbols(model: monaco.editor.ITextModel): monaco.languages.DocumentSymbol[] {
  const byName = new Map<string, monaco.languages.DocumentSymbol>()
  const roots: monaco.languages.DocumentSymbol[] = []
  for (const item of protoDeclarations(model.getValue())) {
    const range = { startLineNumber: item.line, startColumn: item.column, endLineNumber: item.line, endColumn: item.column + item.name.length }
    const symbol: monaco.languages.DocumentSymbol = { name: item.name, detail: item.kind, kind: SYMBOL_KIND[item.kind], tags: [], range, selectionRange: range, children: [] }
    const parent = item.parent ? byName.get(item.parent) : undefined
    if (parent) parent.children = [...(parent.children ?? []), symbol]
    else roots.push(symbol)
    if (item.kind !== 'rpc') byName.set(item.name, symbol)
  }
  return roots
}

/** Go to definition of a message/enum/service: this file first, then the files it imports. */
async function protoDefinition(model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.Location[]> {
  const word = model.getWordAtPosition(position)
  if (!word) return []
  // Qualified names (google.protobuf.Empty, shop.v1.Order): resolve the whole dotted token by its last part.
  const lineText = model.getLineContent(position.lineNumber)
  const dotted = /[\w.]+/g
  let token = word.word
  for (const match of lineText.matchAll(dotted)) {
    const start = (match.index ?? 0) + 1
    if (position.column >= start && position.column <= start + match[0].length) token = match[0]
  }
  const local = findProtoType(protoDeclarations(model.getValue()), token)
  if (local) return [{ uri: model.uri, range: { startLineNumber: local.line, startColumn: local.column, endLineNumber: local.line, endColumn: local.column + local.name.length } }]
  const document = documentForModel(model)
  const session = document && useGoIDEStore.getState().sessions.find((item) => item.id === document.document.sessionId)
  if (!document || !session) return []
  for (const imported of protoImports(model.getValue())) {
    for (const candidate of importCandidates(document.document.relativePath, imported)) {
      const text = await readDevContextFile(session.id, candidate).catch(() => null)
      if (text === null) continue
      const found = findProtoType(protoDeclarations(text), token)
      if (!found) break
      const path = `${session.project.rootPath.replace(/[\\/]+$/, '')}/${candidate}`
      const range = { startLine: found.line, startColumn: found.column, endLine: found.line, endColumn: found.column + found.name.length }
      return rememberLocations([{ uri: monaco.Uri.file(path).toString(), path, relativePath: candidate, external: false, range }])
    }
  }
  return []
}

async function exists(sessionId: string, relativePath: string): Promise<boolean> {
  return readDevContextFile(sessionId, relativePath).then(() => true, () => false)
}

function showRun(sessionId: string, executionId: string): void {
  useGoIDEStore.setState((state) => ({ activeRunBySession: { ...state.activeRunBySession, [sessionId]: executionId } }))
  useGoIDELspStore.getState().showToolWindow('run')
}

/** Generate Go code for a .proto: buf generate if configured, else protoc in the nearest Go module. */
async function generateGo(documentId: string): Promise<void> {
  const document = useGoIDEStore.getState().documents.find((item) => item.document.id === documentId)
  if (!document) return
  const { sessionId, relativePath } = document.document
  const dirs = ancestorDirs(relativePath)
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
  try {
    for (const dir of dirs) {
      if (!(await exists(sessionId, join(dir, 'buf.gen.yaml')))) continue
      const buf = await detectGoIDEGoTool(sessionId, 'buf')
      if (!buf.available) break // fall back to protoc
      return showRun(sessionId, (await runGoIDEGoTool(sessionId, 'buf', ['generate'], dir)).id)
    }
    let moduleDir: string | null = null
    for (const dir of dirs) if (moduleDir === null && await exists(sessionId, join(dir, 'go.mod'))) moduleDir = dir
    if (moduleDir === null) return showEntityNotice('No go.mod above this .proto: open the Go module that owns it.')
    const protoc = await detectGoIDEGoTool(sessionId, 'protoc')
    if (!protoc.available) return showEntityNotice('protoc is not installed: get it from https://protobuf.dev/installation/ (or add buf.gen.yaml and install buf).')
    const needed = protoRpcs(document.buffer).length > 0 ? [PLUGINS.go, PLUGINS.grpc] : [PLUGINS.go]
    const found = await Promise.all(needed.map((plugin) => detectGoIDEGoTool(sessionId, plugin.binary)))
    const missing = needed.filter((_, index) => !found[index].available)
    if (missing.length) {
      const approved = await confirm({ title: `Install ${missing.map((plugin) => plugin.binary).join(' and ')}?`, message: `${missing.map((plugin) => `go install ${plugin.module}`).join('\n')}\n\nThey go into adOmnia's tools folder, built with the project's Go SDK. Run Generate Go code again when the install finishes.`, confirmLabel: 'Install' })
      if (!approved) return
      for (const plugin of missing) showRun(sessionId, (await installGoIDEGoModule(sessionId, plugin.module)).id)
      return
    }
    const protoPath = moduleDir ? relativePath.slice(moduleDir.length + 1) : relativePath
    const args = protocArguments(protoPath, { go: found[0].path ?? PLUGINS.go.binary, grpc: found[1]?.path })
    showRun(sessionId, (await runGoIDEGoTool(sessionId, 'protoc', args, moduleDir)).id)
  } catch (error) {
    showEntityNotice(`Generate Go code failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Registra i CodeLens dei file .proto, una sola volta per processo. */
export function registerGoStudioProtoLens(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(GENERATE_COMMAND, (_accessor, documentId: string) => { void generateGo(documentId) })
  monaco.editor.registerCommand(LINK_COMMAND, (_accessor, sessionId: string) => {
    void architectureFor(sessionId).then(() => changed.fire(provider), () => undefined)
  })
  monaco.editor.registerCommand(HANDLER_COMMAND, (_accessor, sessionId: string, service: string, method: string) => {
    const handler = handlerOf(sessionId, service, method)
    if (handler) openArchSite(handler.site)
  })
  monaco.editor.registerCommand(CALL_COMMAND, (_accessor, documentId: string, service: string, method: string) => callInClient(documentId, { service, method }))
  monaco.editor.registerCommand(DEBUG_COMMAND, (_accessor, sessionId: string, documentId: string, service: string, method: string) => {
    const handler = handlerOf(sessionId, service, method)
    if (!handler) return
    void (async () => {
      const { debugGoAt } = await import('@/lib/devsession/debugMessage')
      const live = await debugGoAt({ goSessionId: sessionId, relativePath: handler.site.relativePath, line: handler.site.line })
      const port = await livePort(live.id)
      callInClient(documentId, { service, method }, port ? `127.0.0.1:${port}` : undefined)
    })()
  })
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.external) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(document.document.sessionId, document.document.id, model.getValue()), dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider(LANGUAGE, provider)
  monaco.languages.registerDocumentSymbolProvider(LANGUAGE, { provideDocumentSymbols: (model) => protoSymbols(model) })
  monaco.languages.registerDefinitionProvider(LANGUAGE, { provideDefinition: (model, position) => protoDefinition(model, position) })
}
