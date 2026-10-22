import { monaco } from '@/lib/monacoSetup'
import { isPythonManifest, parsePythonManifest, pythonRequirementStatuses, pythonVersionEdit, type PythonRequirementStatus } from '@/lib/code-studio/pythonManifestSecurity'
import { EMPTY_PYTHON_SECURITY_STATE, usePythonSecurityStore, type PythonSecurityState } from '@/stores/codeStudioPythonSecurity'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'
import { documentForModel } from './codeStudioLanguageFeatures'
import { editorModelUri } from './codeStudioModelUri'

const MARKER_OWNER = 'adomnia-python-manifest-security'
const SCAN_COMMAND = 'codeStudio.pythonManifestScan'
const FIX_COMMAND = 'codeStudio.pythonManifestFix'
const NEXT_PROBLEM_COMMAND = 'editor.action.marker.next'
/** `requirements*.txt` arriva come `plaintext`, `pyproject.toml` come `ini`: il filtro vero è il nome del file. */
const LANGUAGES = ['plaintext', 'ini']

let registered = false

function stateOf(documentId: string): PythonSecurityState {
  return usePythonSecurityStore.getState().byDocument[documentId] ?? EMPTY_PYTHON_SECURITY_STATE
}

function modelOf(document: GoIDEEditorDocument): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
}

function documentById(documentId: string): GoIDEEditorDocument | null {
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
  return document && isPythonManifest(document.document.relativePath) ? document : null
}

/** Solo le righe con almeno un advisory producono marker, lens e correzione. */
function vulnerableOf(documentId: string, text: string, relativePath: string): PythonRequirementStatus[] {
  return pythonRequirementStatuses(parsePythonManifest(relativePath, text), stateOf(documentId).findings).filter((status) => status.worst)
}

function lensRange(line: number): monaco.IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

function fixEdit(model: monaco.editor.ITextModel, status: PythonRequirementStatus) {
  if (!status.fixVersion) return null
  const { line } = status.requirement
  const edit = line <= model.getLineCount() ? pythonVersionEdit(model.getLineContent(line), status.requirement, status.fixVersion) : null
  return edit && { range: { startLineNumber: line, startColumn: edit.startColumn, endLineNumber: line, endColumn: edit.endColumn }, text: edit.text }
}

function markersFor(model: monaco.editor.ITextModel, document: GoIDEEditorDocument): monaco.editor.IMarkerData[] {
  return vulnerableOf(document.document.id, model.getValue(), document.document.relativePath).map((status) => {
    const { line, name, version } = status.requirement
    const ids = status.vulnerabilities.slice(0, 3).map((item) => `${item.id} (${item.band})`).join(', ')
    const severe = status.worst === 'critical' || status.worst === 'high'
    return {
      startLineNumber: line, startColumn: Math.max(1, model.getLineContent(line).indexOf(name) + 1), endLineNumber: line, endColumn: model.getLineMaxColumn(line),
      severity: severe ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, source: 'OSV',
      message: `${name} ${version}: ${ids}${status.fixVersion ? `. Fixed in ${status.fixVersion}.` : '. No fixed version published.'}`,
    }
  })
}

function refreshMarkers(): void {
  for (const document of useCodeStudioStore.getState().documents) {
    if (!isPythonManifest(document.document.relativePath)) continue
    const model = modelOf(document)
    if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, markersFor(model, document))
  }
}

function lensesFor(model: monaco.editor.ITextModel, document: GoIDEEditorDocument): monaco.languages.CodeLens[] {
  const state = stateOf(document.document.id)
  const vulnerable = vulnerableOf(document.document.id, model.getValue(), document.document.relativePath)
  const lenses: monaco.languages.CodeLens[] = [{
    range: lensRange(1),
    command: { id: SCAN_COMMAND, title: state.scanning ? '… Scanning' : '⛨ Scan vulnerabilities', tooltip: 'Match the requirements against OSV (only package names and versions leave your machine)', arguments: [document.document.id] },
  }]
  if (state.error) lenses.push({ range: lensRange(1), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ ${state.error}` } })
  else if (state.scannedAt) lenses.push({ range: lensRange(1), command: { id: NEXT_PROBLEM_COMMAND, title: `${vulnerable.length} vulnerable`, tooltip: 'Go to the next problem' } })
  for (const status of vulnerable) {
    const first = status.vulnerabilities[0]
    const more = status.vulnerabilities.length > 1 ? ` +${status.vulnerabilities.length - 1}` : ''
    lenses.push({ range: lensRange(status.requirement.line), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ ${first.id}${more} · ${status.worst?.toUpperCase()}${status.fixVersion ? ` · fixed in ${status.fixVersion}` : ''}`, tooltip: first.summary || 'Vulnerability found by OSV' } })
    if (fixEdit(model, status)) lenses.push({ range: lensRange(status.requirement.line), command: { id: FIX_COMMAND, title: `↑ ${status.fixVersion} (security fix)`, tooltip: `Pin ${status.requirement.name} to the fixed version`, arguments: [document.document.id, status.requirement.line] } })
  }
  return lenses
}

/** Applica la correzione come edit normale dell'editor: annullabile e visibile come modifica non salvata. */
function applyFix(documentId: string, line: number): void {
  const document = documentById(documentId)
  const model = document && modelOf(document)
  const status = model && document && vulnerableOf(documentId, model.getValue(), document.document.relativePath).find((item) => item.requirement.line === line)
  const edit = model && status && fixEdit(model, status)
  if (model && edit) model.pushEditOperations([], [edit], () => null)
}

/** requirements*.txt e pyproject.toml: CVE da OSV come lens, marker e correzione a un click. Una volta per processo. */
export function registerCodeStudioPythonSecurity(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(SCAN_COMMAND, (_accessor, documentId: string) => {
    const document = documentById(documentId)
    if (document) void usePythonSecurityStore.getState().scan(documentId, document.document.path, document.document.relativePath)
  })
  monaco.editor.registerCommand(FIX_COMMAND, (_accessor, documentId: string, line: number) => applyFix(documentId, line))
  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || !isPythonManifest(document.document.relativePath)) return { lenses: [], dispose: () => undefined }
      return { lenses: lensesFor(model, document), dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider(LANGUAGES, provider)
  monaco.languages.registerCodeActionProvider(LANGUAGES, {
    provideCodeActions: (model, range) => {
      const document = documentForModel(model)
      if (!document || !isPythonManifest(document.document.relativePath)) return { actions: [], dispose: () => undefined }
      const actions: monaco.languages.CodeAction[] = []
      for (const status of vulnerableOf(document.document.id, model.getValue(), document.document.relativePath)) {
        if (status.requirement.line < range.startLineNumber || status.requirement.line > range.endLineNumber) continue
        const edit = fixEdit(model, status)
        if (!edit) continue
        actions.push({
          title: `Update ${status.requirement.name} to ${status.fixVersion} (security fix)`, kind: 'quickfix', isPreferred: true,
          edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: edit }] },
        })
      }
      return { actions, dispose: () => undefined }
    },
  }, { providedCodeActionKinds: ['quickfix'] })
  usePythonSecurityStore.subscribe((state, previous) => {
    if (state.byDocument === previous.byDocument) return
    refreshMarkers()
    changed.fire(provider)
  })
}
