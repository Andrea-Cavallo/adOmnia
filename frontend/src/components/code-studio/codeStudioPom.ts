import { monaco } from '@/lib/monacoSetup'
import { dependencyStatuses, isBuildFile, updateEdit, type PomDependencyStatus } from '@/lib/code-studio/pomInsights'
import { usePomStore, type PomState } from '@/stores/codeStudioPom'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { documentForModel } from './codeStudioLanguageFeatures'
import { editorModelUri } from './codeStudioModelUri'

const LANGUAGES = ['xml', 'kotlin'] // pom.xml, build.gradle(.kts): gli altri file di questi linguaggi non hanno lens
const MARKER_OWNER = 'adomnia-pom'
const CHECK_COMMAND = 'codeStudio.pomCheckUpdates'
const SCAN_COMMAND = 'codeStudio.pomScan'
const UPDATE_COMMAND = 'codeStudio.pomUpdate'
const NEXT_PROBLEM_COMMAND = 'editor.action.marker.next'

const EMPTY_STATE: PomState = { dependencies: [], versions: [], findings: [], checkingUpdates: false, scanning: false, updatesCheckedAt: '', scannedAt: '', error: '' }

let registered = false
/** Ultimo testo analizzato per documento: i lens si rigenerano a ogni cambio di stato, il parse solo a ogni edit. */
const parsedContent = new Map<string, string>()

function stateOf(documentId: string): PomState {
  return usePomStore.getState().byDocument[documentId] ?? EMPTY_STATE
}

function statusesOf(documentId: string): PomDependencyStatus[] {
  const state = stateOf(documentId)
  return dependencyStatuses(state.dependencies, state.versions, state.findings)
}

function lensRange(line: number): monaco.IRange {
  return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }
}

function modelOf(document: GoIDEEditorDocument): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
}

function documentById(documentId: string): GoIDEEditorDocument | null {
  const document = useCodeStudioStore.getState().documents.find((item) => item.document.id === documentId)
  return document && isBuildFile(document.document.relativePath) ? document : null
}

/** Gli aggiornamenti proponibili: prima la correzione dei CVE, poi l'ultima dello stesso major, poi l'ultima in assoluto. */
function updateTargets(status: PomDependencyStatus): Array<{ version: string; label: string }> {
  const targets: Array<{ version: string; label: string }> = []
  const current = status.dependency.resolved
  const push = (version: string | undefined, label: string) => {
    if (version && version !== current && !targets.some((item) => item.version === version)) targets.push({ version, label })
  }
  push(status.fixVersion, 'security fix')
  if (status.version?.newer) {
    push(status.version.sameMajor, 'same major')
    push(status.version.latest, 'latest')
  }
  return targets
}

function summaryLens(documentId: string, state: PomState): string {
  if (state.error) return `⚠ ${state.error}`
  const statuses = statusesOf(documentId)
  const outdated = statuses.filter((item) => item.version?.newer).length
  const vulnerable = statuses.filter((item) => item.worst || item.viaThis.length).length
  const parts: string[] = []
  if (state.updatesCheckedAt) parts.push(`${outdated} outdated`)
  if (state.scannedAt) parts.push(`${vulnerable} vulnerable`)
  return parts.join(' · ')
}

function toolbarLenses(documentId: string, state: PomState, scannable: boolean): monaco.languages.CodeLens[] {
  const lenses: monaco.languages.CodeLens[] = [
    { range: lensRange(1), command: { id: CHECK_COMMAND, title: state.checkingUpdates ? '… Checking Maven Central' : '↻ Check for updates', tooltip: 'Look up the latest stable versions on Maven Central (only group:artifact leaves your machine)', arguments: [documentId] } },
  ]
  if (scannable) lenses.push({ range: lensRange(1), command: { id: SCAN_COMMAND, title: state.scanning ? '… Scanning' : '⛨ Scan vulnerabilities', tooltip: 'Match the dependencies against OSV (only coordinates leave your machine)', arguments: [documentId] } })
  const summary = summaryLens(documentId, state)
  if (summary) lenses.push({ range: lensRange(1), command: { id: NEXT_PROBLEM_COMMAND, title: summary, tooltip: 'Go to the next problem' } })
  return lenses
}

function dependencyLenses(documentId: string, status: PomDependencyStatus): monaco.languages.CodeLens[] {
  const lenses: monaco.languages.CodeLens[] = []
  const line = status.dependency.line
  if (status.worst) {
    const first = status.vulnerabilities[0]
    const more = status.vulnerabilities.length > 1 ? ` +${status.vulnerabilities.length - 1}` : ''
    lenses.push({ range: lensRange(line), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ ${first.id}${more} · ${status.worst.toUpperCase()}${status.fixVersion ? ` · fixed in ${status.fixVersion}` : ''}`, tooltip: first.summary || 'Vulnerability found by OSV' } })
  }
  if (!status.worst && status.viaThis.length) {
    const first = status.viaThis[0]
    lenses.push({ range: lensRange(line), command: { id: NEXT_PROBLEM_COMMAND, title: `⚠ via ${first.component} · ${first.id} · ${first.band.toUpperCase()}${status.viaThis.length > 1 ? ` +${status.viaThis.length - 1}` : ''}`, tooltip: first.summary || 'Vulnerability in a transitive dependency' } })
  }
  for (const target of updateTargets(status)) {
    if (!updateEdit(status.dependency, target.version)) continue
    lenses.push({ range: lensRange(line), command: { id: UPDATE_COMMAND, title: `↑ ${target.version} (${target.label})`, tooltip: `Update ${status.key} to ${target.version}`, arguments: [documentId, line, target.version] } })
  }
  return lenses
}

/** Applica un aggiornamento come edit normale dell'editor: annullabile con Ctrl+Z e visibile come modifica non salvata. */
function applyUpdate(documentId: string, line: number, version: string): void {
  const document = documentById(documentId)
  const model = document && modelOf(document)
  const status = statusesOf(documentId).find((item) => item.dependency.line === line)
  const edit = status && updateEdit(status.dependency, version)
  if (!model || !edit) return
  model.pushEditOperations([], [{ range: { startLineNumber: edit.line, startColumn: edit.startColumn, endLineNumber: edit.line, endColumn: edit.endColumn }, text: edit.text }], () => null)
}

/** Nota sul marker quando la versione non è scritta nel pom ma ereditata. */
const managedNote = (dependency: object) => ('managedBy' in dependency && dependency.managedBy ? ' (version from a parent or BOM: update it where it is defined)' : '')

function markerSeverity(status: PomDependencyStatus): monaco.MarkerSeverity {
  return status.worst === 'critical' || status.worst === 'high' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
}

function markersFor(documentId: string): monaco.editor.IMarkerData[] {
  const markers: monaco.editor.IMarkerData[] = []
  for (const status of statusesOf(documentId)) {
    const dependency = status.dependency
    const range = { startLineNumber: dependency.line, startColumn: dependency.startColumn, endLineNumber: dependency.line, endColumn: dependency.endColumn }
    if (status.worst) {
      const ids = status.vulnerabilities.slice(0, 3).map((item) => `${item.id} (${item.band})`).join(', ')
      markers.push({ ...range, severity: markerSeverity(status), source: 'OSV', message: `${status.key} ${dependency.resolved}${managedNote(dependency)}: ${ids}${status.fixVersion ? `. Fixed in ${status.fixVersion}.` : '. No fixed version published.'}` })
    } else if (status.viaThis.length) {
      const first = status.viaThis[0]
      const more = status.viaThis.length > 1 ? ` and ${status.viaThis.length - 1} more` : ''
      markers.push({ ...range, severity: first.band === 'critical' || first.band === 'high' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, source: 'OSV', message: `${status.key} brings in ${first.component}: ${first.id} (${first.band})${more}. Update this dependency, or manage the transitive version in dependencyManagement.` })
    } else if (status.version?.newer) {
      markers.push({ ...range, severity: monaco.MarkerSeverity.Info, source: 'Maven Central', message: `${status.key}: ${dependency.resolved} → ${status.version.latest} available` })
    }
  }
  return markers
}

function refreshMarkers(): void {
  for (const document of useCodeStudioStore.getState().documents) {
    if (!isBuildFile(document.document.relativePath)) continue
    const model = modelOf(document)
    if (model) monaco.editor.setModelMarkers(model, MARKER_OWNER, markersFor(document.document.id))
  }
}

function quickFixes(model: monaco.editor.ITextModel, range: monaco.Range): monaco.languages.CodeAction[] {
  const document = documentForModel(model)
  if (!document || !isBuildFile(document.document.relativePath)) return []
  const actions: monaco.languages.CodeAction[] = []
  for (const status of statusesOf(document.document.id)) {
    if (status.dependency.line < range.startLineNumber || status.dependency.line > range.endLineNumber) continue
    for (const target of updateTargets(status)) {
      const edit = updateEdit(status.dependency, target.version)
      if (!edit) continue
      actions.push({
        title: `Update ${status.dependency.artifactId} to ${target.version} (${target.label})`,
        kind: 'quickfix',
        isPreferred: target.label === 'security fix',
        edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: { startLineNumber: edit.line, startColumn: edit.startColumn, endLineNumber: edit.line, endColumn: edit.endColumn }, text: edit.text } }] },
      })
    }
  }
  return actions
}

/** pom.xml: aggiornamenti da Maven Central, CVE da OSV, e correzione a un click. Una volta per processo. */
export function registerCodeStudioPom(): void {
  if (registered) return
  registered = true
  monaco.editor.registerCommand(CHECK_COMMAND, (_accessor, documentId: string) => {
    const document = documentById(documentId)
    if (document) void usePomStore.getState().checkUpdates(documentId, document.document.sessionId, document.buffer)
  })
  monaco.editor.registerCommand(SCAN_COMMAND, (_accessor, documentId: string) => {
    const document = documentById(documentId)
    if (document) void usePomStore.getState().scanVulnerabilities(documentId, document.document.sessionId, document.document.path, document.document.relativePath)
  })
  monaco.editor.registerCommand(UPDATE_COMMAND, (_accessor, documentId: string, line: number, version: string) => applyUpdate(documentId, line, version))

  const changed = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  const provider: monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses: (model) => {
      const document = documentForModel(model)
      if (!document || document.document.readOnly || !isBuildFile(document.document.relativePath)) return { lenses: [], dispose: () => undefined }
      const documentId = document.document.id
      const text = model.getValue()
      if (parsedContent.get(documentId) !== text) {
        parsedContent.set(documentId, text)
        void usePomStore.getState().refreshDependencies(documentId, document.document.sessionId, text)
      }
      const lenses = [...toolbarLenses(documentId, stateOf(documentId), isBuildFile(document.document.relativePath)), ...statusesOf(documentId).flatMap((status) => dependencyLenses(documentId, status))]
      return { lenses, dispose: () => undefined }
    },
  }
  monaco.languages.registerCodeLensProvider(LANGUAGES, provider)
  monaco.languages.registerCodeActionProvider(LANGUAGES, {
    provideCodeActions: (model, range) => ({ actions: quickFixes(model, monaco.Range.lift(range)), dispose: () => undefined }),
  }, { providedCodeActionKinds: ['quickfix'] })
  usePomStore.subscribe((state, previous) => {
    if (state.byDocument === previous.byDocument) return
    refreshMarkers()
    changed.fire(provider)
  })
}
