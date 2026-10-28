import { monaco } from '@/lib/monacoSetup'
import { useCodeStudioStore } from '@/stores/codeStudio'
import { useSpringStore, springStateOf } from '@/stores/codeStudioSpring'
import type { GoIDEEditorDocument } from '@/stores/codeStudio'
import type { SpringProperty, SpringValue } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'
import {
  beanForInjection,
  effectiveValues,
  injectionAt,
  isJavaPath,
  isSpringConfigPath,
  locationOfBean,
  locationOfProperty,
  locationOfValue,
  propertyForValue,
  propertyMarkdown,
  springCompletions,
  typedPropertyKey,
  typedYamlKey,
  valueFor,
  type SpringLocation,
} from '@/lib/code-studio/springInsights'
import { projectRootOf } from '@/lib/code-studio/pomInsights'
import { documentForModel } from './codeStudioLanguageFeatures'
import { openSpringEndpoints } from './CodeStudioSpringEndpoints'
import { editorModelUri } from './codeStudioModelUri'

const MARKER_OWNER = 'adomnia-spring'
const ENDPOINTS_COMMAND = 'codeStudio.springEndpoints'
const METADATA_COMMAND = 'codeStudio.springMetadata'
/** L'indice si rilegge quando è più vecchio di questo: cambia solo quando il progetto cambia. */
const INDEX_TTL_MILLIS = 30_000

let registered = false
const languages = ['properties', 'ini', 'yaml', 'yml']

function documentFor(model: monaco.editor.ITextModel): GoIDEEditorDocument | null {
  return documentForModel(model)
}

/** L'indice Spring della sessione del documento, aggiornato se mancante o vecchio. */
async function indexFor(document: GoIDEEditorDocument): Promise<ReturnType<typeof springStateOf>['index']> {
  const sessionId = document.document.sessionId
  const state = springStateOf(sessionId)
  const fresh = state.refreshedAt && Date.now() - new Date(state.refreshedAt).getTime() < INDEX_TTL_MILLIS
  if (!state.index || !fresh) await useSpringStore.getState().refresh(sessionId)
  return springStateOf(sessionId).index
}

/** Converte una posizione dell'indice in una posizione Monaco del documento indicato. */
export async function toMonacoLocation(target: SpringLocation | null, from: GoIDEEditorDocument): Promise<monaco.languages.Location | null> {
  if (!target) return null
  const absolute = absolutePathOf(from, target.file)
  const range = {
    startLineNumber: target.line,
    startColumn: target.startColumn || 1,
    endLineNumber: target.line,
    endColumn: Math.max(target.endColumn || 1, target.startColumn || 1),
  }
  const existing = useCodeStudioStore.getState().documents.find((item) => item.document.sessionId === from.document.sessionId && sameFile(item.document.relativePath, target.file))
  if (existing) {
    return { uri: monaco.Uri.parse(editorModelUri(existing.document)), range }
  }
  // Il file non è aperto: lo si legge una volta per dare a Monaco un modello valido.
  const uri = monaco.Uri.file(absolute).with({ fragment: `session=${from.document.sessionId}` })
  if (!monaco.editor.getModel(uri)) {
    try {
      const { openGoIDEDocument, closeGoIDEDocument } = await import('@/lib/code-studio-api')
      const read = await openGoIDEDocument(from.document.sessionId, target.file)
      if (!monaco.editor.getModel(uri)) monaco.editor.createModel(read.content, undefined, uri)
      if (!useCodeStudioStore.getState().documents.some((item) => item.document.id === read.document.id)) {
        void closeGoIDEDocument(from.document.sessionId, read.document.id).catch(() => undefined)
      }
    } catch {
      return null
    }
  }
  return { uri, range }
}

function absolutePathOf(document: GoIDEEditorDocument, relative: string): string {
  const root = projectRootOf(document.document.path, document.document.relativePath)
  return [root, relative].join('/').replace(/\/+/g, '/')
}

function sameFile(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
  return normalize(left) === normalize(right)
}

/** La chiave di configurazione su cui si trova il cursore, con l'intervallo da sostituire. */
function keyAt(model: monaco.editor.ITextModel, position: monaco.Position): { key: string; startColumn: number; endColumn: number } {
  const lines = model.getValue().split('\n')
  const isYaml = /\.(ya?ml)$/i.test(model.uri.path)
  return isYaml ? typedYamlKey(lines, position.lineNumber, position.column) : typedPropertyKey(model.getLineContent(position.lineNumber), position.column)
}

function completionFor(property: SpringProperty, values: Map<string, SpringValue>, parentPrefix: string, range: monaco.IRange): monaco.languages.CompletionItem {
  const insertText = property.name.startsWith(parentPrefix) ? property.name.slice(parentPrefix.length) : property.name
  return {
    label: property.name,
    kind: monaco.languages.CompletionItemKind.Property,
    detail: property.type || undefined,
    documentation: { value: propertyMarkdown(property, values) },
    insertText,
    range,
    sortText: `${property.source === 'project' ? '0' : '1'}${property.name}`,
    tags: property.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
  }
}

function markersFor(index: NonNullable<ReturnType<typeof springStateOf>['index']>, relativePath: string): monaco.editor.IMarkerData[] {
  return (index.diagnostics ?? [])
    .filter((diagnostic) => sameFile(diagnostic.file ?? '', relativePath))
    .map((diagnostic) => ({
      startLineNumber: diagnostic.line || 1,
      startColumn: diagnostic.startColumn || 1,
      endLineNumber: diagnostic.line || 1,
      endColumn: Math.max(diagnostic.endColumn || 1, diagnostic.startColumn || 1),
      severity: diagnostic.severity === 'error' ? monaco.MarkerSeverity.Error : diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      source: 'Spring',
      message: diagnostic.message,
    }))
}

function refreshMarkers(): void {
  for (const document of useCodeStudioStore.getState().documents) {
    if (!isSpringConfigPath(document.document.relativePath)) continue
    const model = monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
    if (!model) continue
    const index = springStateOf(document.document.sessionId).index
    monaco.editor.setModelMarkers(model, MARKER_OWNER, index ? markersFor(index, document.document.relativePath) : [])
  }
}

/** Apri il pannello degli endpoint: elenco filtrabile che porta al metodo del controller. */
async function openEndpoints(sessionId: string): Promise<void> {
  await useSpringStore.getState().refresh(sessionId)
  openSpringEndpoints(sessionId)
}

/**
 * Spring Index in editor: completamento e documentazione delle proprietà di configurazione,
 * navigazione `@Value` ↔ proprietà e `@Autowired` ↔ bean, elenco degli endpoint. Tutto arriva
 * dall'indice statico del progetto: nessun server, nessuna rete.
 */
export function registerCodeStudioSpring(): void {
  if (registered) return
  registered = true

  for (const language of languages) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '-', '_'],
      async provideCompletionItems(model, position) {
        const document = documentFor(model)
        if (!document || !isSpringConfigPath(document.document.relativePath)) return { suggestions: [] }
        const index = await indexFor(document)
        if (!index) return { suggestions: [] }
        const typed = keyAt(model, position)
        const parentPrefix = typed.key.includes('.') ? typed.key.slice(0, typed.key.lastIndexOf('.') + 1) : ''
        const range: monaco.IRange = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: typed.startColumn, endColumn: Math.max(typed.endColumn, typed.startColumn) }
        return {
          suggestions: springCompletions(index, typed.key).map((property) => completionFor(property, effectiveValues(index), parentPrefix, range)),
        }
      },
    })

    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const document = documentFor(model)
        if (!document || !isSpringConfigPath(document.document.relativePath)) return null
        const index = await indexFor(document)
        if (!index) return null
        const key = keyAt(model, position).key
        const property = propertyForValue(index, key)
        if (!property) return null
        return {
          contents: [{ value: propertyMarkdown(property, effectiveValues(index)) }],
          range: new monaco.Range(position.lineNumber, 1, position.lineNumber, model.getLineMaxColumn(position.lineNumber)),
        }
      },
    })

    monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position) {
        const document = documentFor(model)
        if (!document || !isSpringConfigPath(document.document.relativePath)) return null
        const index = await indexFor(document)
        if (!index) return null
        const key = keyAt(model, position).key
        const location = await toMonacoLocation(locationOfProperty(propertyForValue(index, key)), document)
        return location ? [location] : null
      },
    })
  }

  // Nei sorgenti Java: `@Value("${…}")` porta al valore o alla proprietà, `@Autowired` al bean.
  monaco.languages.registerDefinitionProvider('java', {
    async provideDefinition(model, position) {
      const document = documentFor(model)
      if (!document || !isJavaPath(document.document.relativePath)) return null
      const index = await indexFor(document)
      if (!index) return null
      const line = position.lineNumber
      const injection = injectionAt(index, document.document.relativePath, line)
      if (injection) {
        const location = await toMonacoLocation(locationOfBean(beanForInjection(index, injection)), document)
        return location ? [location] : null
      }
      const reference = (index.propertyReferences ?? []).find((item) => sameFile(item.file ?? '', document.document.relativePath) && item.line === line)
      if (!reference) return null
      const target = locationOfProperty(propertyForValue(index, reference.key)) ?? locationOfValue(valueFor(index, reference.key))
      const location = await toMonacoLocation(target, document)
      return location ? [location] : null
    },
  })

  monaco.editor.registerCommand(ENDPOINTS_COMMAND, (_accessor, sessionId: string) => {
    void openEndpoints(sessionId)
  })

  monaco.editor.registerCommand(METADATA_COMMAND, (_accessor, sessionId: string) => {
    void useSpringStore.getState().refreshMetadata(sessionId).then(refreshMarkers)
  })

  useSpringStore.subscribe((state, previous) => {
    if (state.bySession === previous.bySession) return
    refreshMarkers()
  })

  // Primo indice: si costruisce quando un documento Spring entra in editor.
  useCodeStudioStore.subscribe((state, previous) => {
    if (state.documents === previous.documents) return
    for (const document of state.documents) {
      const touched = !previous.documents.some((item) => item.document.id === document.document.id)
      if (!touched || !isSpringConfigPath(document.document.relativePath)) continue
      void indexFor(document).then(refreshMarkers)
    }
  })
}

export const SPRING_ENDPOINTS_COMMAND = ENDPOINTS_COMMAND
export const SPRING_METADATA_COMMAND = METADATA_COMMAND
