import { monaco } from '@/lib/monacoSetup'
import { confirm } from '@/lib/confirmDialog'
import { installGoIDEGoModule } from '@/lib/code-studio-api'
import { useCodeStudioLspStore } from '@/stores/codeStudioLsp'
import { goModStatuses, goModVersionEdit, type GoModRequirementStatus } from '@/lib/code-studio/goModSecurity'
import { EMPTY_GO_VULN_STATE, useGoVulnStore, type GoVulnState } from '@/stores/codeStudioGoVuln'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { parseGoMod } from './codeStudioGoMod'
import { documentForModel } from './codeStudioLanguageFeatures'
import { editorModelUri } from './codeStudioModelUri'

const MARKER_OWNER = 'adomnia-gomod-security'
const SCAN_COMMAND = 'codeStudio.goModScan'
const FIX_COMMAND = 'codeStudio.goModFix'
const INSTALL_COMMAND = 'codeStudio.goModInstallGovulncheck'
const GOVULNCHECK_MODULE = 'golang.org/x/vuln/cmd/govulncheck@latest'
const NEXT_PROBLEM_COMMAND = 'editor.action.marker.next'

let registered = false

const isGoMod = (relativePath: string) => relativePath.split(String.fromCharCode(92)).join('/').split('/').pop() === 'go.mod'

function stateOf(documentId: string): GoVulnState {
  return useGoVulnStore.getState().byDocument[documentId] ?? EMPTY_GO_VULN_STATE
}

function modelOf(document: GoIDEEditorDocument): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
}

function documentById(documentId: string): GoIDEEditorDocument | null {
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
  return document && isGoMod(document.document.relativePath) ? document : null
}

/** Solo i require con almeno un advisory: sono gli unici che producono marker, lens e correzioni. */
function vulnerableOf(documentId: string, text: string): GoModRequirementStatus[] {
  return goModStatuses(parseGoMod(text).requirements, stateOf(documentId).findings).filter((status) => status.worst)
}

function lensRange(line: number): monaco.IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

function fixEdit(model: monaco.editor.ITextModel, status: GoModRequirementStatus) {
  if (!status.fixVersion) return null
  const { line } = status.requirement
  const edit = line <= model.getLineCount() ? goModVersionEdit(model.getLineContent(line), status.requirement, status.fixVersion) : null
  return edit && { range: { startLineNumber: line, startColumn: edit.startColumn, endLineNumber: line, endColumn: edit.endColumn }, text: edit.text }
}

function markersFor(model: monaco.editor.ITextModel, documentId: string): monaco.editor.IMarkerData[] {
  return vulnerableOf(documentId, model.getValue()).map((status) => {
    const { line, path, version } = status.requirement
    const ids = status.vulnerabilities.slice(0, 3).map((item) => `${item.id} (${item.band})`).join(', ')
    const column = model.getLineContent(line).indexOf(path) + 1
    const severe = status.worst === 'critical' || status.worst === 'high'
    return {
      startLineNumber: line, startColumn: Math.max(1, column), endLineNumber: line, endColumn: model.getLineMaxColumn(line),
      severity: severe ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, source: 'OSV',
      message: `${path} ${version}: ${ids}${status.fixVersion ? `. Fixed in ${status.fixVersion}.` : '. No fixed version published.'}`,
    }
  })
}

function refreshMarkers(): void {
  for (const document of useCodeStudioStore.getState().documents) {
    if (!isGoMod(document.document.relativePath)) continue
    const model = modelOf(document)
    if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, markersFor(model, document.document.id))
  }
}

function lensesFor(model: monaco.editor.ITextModel, documentId: string): monaco.languages.CodeLens[] {
  const state = stateOf(documentId)
  const vulnerable = vulnerableOf(documentId, model.getValue())
  const lenses: monaco.languages.CodeLens[] = [{
    range: lensRange(1),
    command: { id: SCAN_COMMAND, title: state.scanning ? '… Scanning' : '⛨ Scan vulnerabilities', tooltip: 'Match the requirements against OSV (only module paths and versions leave your machine)', arguments: [documentId] },
  }]
  if (state.error) lenses.push({ range: lensRange(1), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ ${state.error}` } })
  else if (state.scannedAt) lenses.push({ range: lensRange(1), command: { id: NEXT_PROBLEM_COMMAND, title: `${vulnerable.length} vulnerable`, tooltip: 'Go to the next problem' } })
  if (state.govulncheck === 'missing') lenses.push({ range: lensRange(1), command: { id: INSTALL_COMMAND, title: 'ℹ Reachability off · Install govulncheck…', tooltip: 'govulncheck tells which vulnerable functions your code really calls; without it findings stay at "required"', arguments: [documentId] } })
  for (const status of vulnerable) {
    const first = status.vulnerabilities[0]
    const more = status.vulnerabilities.length > 1 ? ` +${status.vulnerabilities.length - 1}` : ''
    lenses.push({ range: lensRange(status.requirement.line), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ ${first.id}${more} · ${status.worst?.toUpperCase()}${status.fixVersion ? ` · fixed in ${status.fixVersion}` : ''}`, tooltip: first.summary || 'Vulnerability found by OSV' } })
    if (fixEdit(model, status)) lenses.push({ range: lensRange(status.requirement.line), command: { id: FIX_COMMAND, title: `↑ ${status.fixVersion} (security fix)`, tooltip: `Set ${status.requirement.path} to the fixed version (run Tidy afterwards)`, arguments: [documentId, status.requirement.line] } })
  }
  return lenses
}

/** Applica la correzione come edit normale dell'editor: annullabile con Ctrl+Z e visibile come modifica non salvata. */
function applyFix(documentId: string, line: number): void {
  const document = documentById(documentId)
  const model = document && modelOf(document)
  const status = model && vulnerableOf(documentId, model.getValue()).find((item) => item.requirement.line === line)
  const edit = model && status && fixEdit(model, status)
  if (model && edit) model.pushEditOperations([], [edit], () => null)
}

/** go install di govulncheck: sempre con conferma e output nella console Run, come in Tools → Go Tools. */
async function installGovulncheck(sessionId: string): Promise<void> {
  const approved = await confirm({ title: 'Install govulncheck?', message: `go install ${GOVULNCHECK_MODULE} downloads the module and builds it into adOmnia's tools folder, with the project's Go SDK.`, confirmLabel: 'Install' })
  if (!approved) return
  await installGoIDEGoModule(sessionId, GOVULNCHECK_MODULE)
  useCodeStudioLspStore.getState().showToolWindow('run')
}

/** go.mod: CVE da OSV come lens, marker e correzione a un click, come il pom.xml. Una volta per processo. */
export function registerCodeStudioGoVuln(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(SCAN_COMMAND, (_accessor, documentId: string) => {
    const document = documentById(documentId)
    if (document) void useGoVulnStore.getState().scan(documentId, document.document.sessionId, document.document.path, document.document.relativePath)
  })
  monaco.editor.registerCommand(INSTALL_COMMAND, (_accessor, documentId: string) => {
    const document = documentById(documentId)
    if (document) void installGovulncheck(document.document.sessionId)
  })
  monaco.editor.registerCommand(FIX_COMMAND, (_accessor, documentId: string, line: number) => applyFix(documentId, line))
  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || !isGoMod(document.document.relativePath)) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(model, document.document.id), dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider('go', provider)
  monaco.languages.registerCodeActionProvider('go', {
    provideCodeActions: (model, range) => {
      const document = documentForModel(model)
      if (!document || !isGoMod(document.document.relativePath)) return { actions: [], dispose: () => undefined }
      const actions: monaco.languages.CodeAction[] = []
      for (const status of vulnerableOf(document.document.id, model.getValue())) {
        if (status.requirement.line < range.startLineNumber || status.requirement.line > range.endLineNumber) continue
        const edit = fixEdit(model, status)
        if (!edit) continue
        actions.push({
          title: `Update ${status.requirement.path} to ${status.fixVersion} (security fix)`, kind: 'quickfix', isPreferred: true,
          edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: edit }] },
        })
      }
      return { actions, dispose: () => undefined }
    },
  }, { providedCodeActionKinds: ['quickfix'] })
  useGoVulnStore.subscribe((state, previous) => {
    if (state.byDocument === previous.byDocument) return
    refreshMarkers()
    changed.fire(provider)
  })
}
