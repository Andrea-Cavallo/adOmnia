import { monaco } from '@/lib/monacoSetup'
import { InvokeIDEExtension } from '../../../bindings/adomnia/goide'
import { subscribeGoIDEEvents } from '@/lib/goide-api'
import { extensionResult } from '@/lib/goide/extensionResult'
import { extensionLanguageForPath, useIDEExtensionsStore, type IDEContribution } from '@/stores/ideExtensions'
import { useGoIDEStore } from '@/stores/goide'
import { useGoIDELspStore } from '@/stores/goideLsp'
import { usePluginsStore } from '@/stores/plugins'
import { documentForModel, registerGoStudioLanguageFeatures } from './goStudioLanguageFeatures'
import { activeGoStudioEditor } from './goStudioEditorRegistry'
import { editorModelUri } from './goStudioModelUri'

let started = false
const applies = (item: IDEContribution, language: string) => !item.languages?.length || item.languages.includes(language)

export async function runIDEContribution(item: IDEContribution, documentId?: string, analyzer = false): Promise<void> {
 const state = useGoIDEStore.getState()
 const sessionId = state.activeSessionId
 if (!sessionId) return
 const id = documentId ?? state.activeDocumentBySession[sessionId]
 const document = state.documents.find(doc => doc.document.id === id && doc.document.sessionId === sessionId)
 const buffer = document?.buffer ?? ''
 const editor = activeGoStudioEditor(), selection = editor?.getSelection()
 const model = editor?.getModel()
 const language = document ? extensionLanguageForPath(document.document.relativePath)?.id ?? document.document.language : ''
 if (document && !applies(item,language)) return
 try {
  const result = await InvokeIDEExtension({sessionId,pluginId:item.pluginId,id:item.id,kind:item.kind,documentId:document?.document.id ?? '',text:buffer,selection: model && document && model.uri.toString() === editorModelUri(document.document) ? selection : null})
  if (!result.success) throw new Error(result.error || 'Extension failed')
  const current = useGoIDEStore.getState()
  const fresh = current.documents.find(doc => doc.document.id === document?.document.id)
  if (current.activeSessionId !== sessionId || (document && (!fresh || fresh.buffer !== buffer))) return
  if (!analyzer && document && current.activeDocumentBySession[sessionId] !== document.document.id) return
  if (!useIDEExtensionsStore.getState().items.some(c => c.pluginId === item.pluginId && c.id === item.id && c.kind === item.kind)) return
  const parsed = extensionResult(result.data)
  if (document) useIDEExtensionsStore.setState(state => ({reports:{...state.reports,[sessionId]:{...state.reports[sessionId],[`${item.pluginId}:${item.kind}:${item.id}:${document.document.id}`]:{uri:editorModelUri(document.document),path:document.document.path,relativePath:document.document.relativePath,documentId:document.document.id,diagnostics:parsed.diagnostics.map(d => ({range:{startLine:d.line,startColumn:d.column,endLine:d.endLine,endColumn:d.endColumn},severity:d.severity,message:d.message,source:`${item.pluginName}: ${item.title}`}))}}}}))
  if (document && model && model.uri.toString() === editorModelUri(document.document)) {
   monaco.editor.setModelMarkers(model,`plugin:${item.pluginId}:${item.id}`,parsed.diagnostics.map(d => ({startLineNumber:d.line,startColumn:d.column,endLineNumber:d.endLine,endColumn:d.endColumn,message:d.message,severity:[0,monaco.MarkerSeverity.Error,monaco.MarkerSeverity.Warning,monaco.MarkerSeverity.Info,monaco.MarkerSeverity.Hint][d.severity],source:item.title})))
  } else if (document) {
   const target = monaco.editor.getModel(monaco.Uri.parse(editorModelUri(document.document)))
   if (target) monaco.editor.setModelMarkers(target,`plugin:${item.pluginId}:${item.id}`,parsed.diagnostics.map(d => ({startLineNumber:d.line,startColumn:d.column,endLineNumber:d.endLine,endColumn:d.endColumn,message:d.message,severity:[0,monaco.MarkerSeverity.Error,monaco.MarkerSeverity.Warning,monaco.MarkerSeverity.Info,monaco.MarkerSeverity.Hint][d.severity],source:item.title})))
  }
  if (parsed.message) useGoIDELspStore.setState({message:`${item.pluginName}: ${parsed.message}`})
  if (!analyzer && document && parsed.text !== undefined && parsed.text !== buffer) {
   const lines = buffer.split('\n')
   if (useGoIDELspStore.getState().pendingChange) throw new Error('Review or discard the pending change before requesting another extension edit')
   useGoIDELspStore.setState({pendingChange:{label:item.title,files:[{uri:editorModelUri(document.document),path:document.document.path,relativePath:document.document.relativePath,documentId:document.document.id,originalContent:buffer,newContent:parsed.text,edits:[{range:{startLine:1,startColumn:1,endLine:lines.length,endColumn:lines[lines.length-1].length+1},text:parsed.text}]}]}})
  }
 } catch (error) { useGoIDELspStore.setState({message:`${item.title}: ${String(error)}`}) }
}

export function startGoStudioExtensions(): void {
 if (started) return; started = true
 const register = () => {
  const items = useIDEExtensionsStore.getState().items
  const languages = items.filter(c => c.kind === 'language')
  for (const c of languages) {
   const id = c.monaco || c.id
   if (!monaco.languages.getLanguages().some(l => l.id === id)) monaco.languages.register({id,extensions:c.extensions})
  }
  registerGoStudioLanguageFeatures(languages.filter(c => c.server).map(c => c.monaco || c.id))
  for (const model of monaco.editor.getModels()) for (const item of previousItems.filter(c => !items.some(next => next.pluginId === c.pluginId && next.id === c.id && next.kind === c.kind && JSON.stringify(next) === JSON.stringify(c)))) monaco.editor.setModelMarkers(model,`plugin:${item.pluginId}:${item.id}`,[])
  const removed = previousItems.filter(c => !items.some(next => next.pluginId === c.pluginId && next.id === c.id && next.kind === c.kind && JSON.stringify(next) === JSON.stringify(c)))
  if (removed.length) useIDEExtensionsStore.setState(state => ({reports:Object.fromEntries(Object.entries(state.reports).map(([session,reports]) => [session,Object.fromEntries(Object.entries(reports).filter(([key]) => !removed.some(c => key.startsWith(`${c.pluginId}:${c.kind}:${c.id}:`))))]))}))
  if (JSON.stringify(previousItems) !== JSON.stringify(items)) void import('@/stores/devcontext').then(({useDevContextStore}) => {
   const context = useDevContextStore.getState()
   for (const sessionId of Object.keys(context.snapshots)) void context.load(sessionId)
  })
  previousItems = items
 }
 let previousItems: IDEContribution[] = []
 useIDEExtensionsStore.subscribe((state,previous) => { if (state.items !== previous.items) register() })
 void useIDEExtensionsStore.getState().load()
 window.addEventListener('focus',() => void useIDEExtensionsStore.getState().load())
 usePluginsStore.subscribe((state,previous) => { if (state.plugins !== previous.plugins) void useIDEExtensionsStore.getState().load() })
 subscribeGoIDEEvents(event => {
  if (!event.sessionId) return
  const eventSessionId = event.sessionId
  if (event.type === 'lsp.status') {
   const status = event.payload as {language?: string; state?: string}
   if (status.language && status.language !== 'go' && (status.state === 'stopped' || status.state === 'crashed')) {
    const language = useIDEExtensionsStore.getState().items.find(item => item.kind === 'language' && item.id === status.language)
    if (language) {
     const reports = useGoIDELspStore.getState().diagnostics[eventSessionId] ?? {}
     const stale = Object.values(reports).filter(report => report.relativePath !== undefined && extensionLanguageForPath(report.relativePath, [language]))
     const uris = new Set(stale.map(report => report.uri))
     useGoIDELspStore.setState(state => ({diagnostics:{...state.diagnostics,[eventSessionId]:Object.fromEntries(Object.entries(reports).filter(([uri]) => !uris.has(uri)))}}))
     for (const uri of uris) {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri))
      if (model) monaco.editor.setModelMarkers(model,'gopls',[])
     }
    }
   }
   return
  }
  if (event.type !== 'document.saved') return
  const document = event.payload as {id?:string; sessionId?:string}
  if (useGoIDEStore.getState().activeSessionId !== event.sessionId) return
  for (const c of useIDEExtensionsStore.getState().items.filter(c => c.kind === 'analyzer')) void runIDEContribution(c,document.id,true)
 })
 useGoIDEStore.subscribe((state,previous) => {
  if (state.documents === previous.documents) return
  const stale = previous.documents.filter(old => {const fresh = state.documents.find(doc => doc.document.id === old.document.id); return !fresh || fresh.buffer !== old.buffer})
  if (!stale.length) return
  useIDEExtensionsStore.setState(ext => ({reports:Object.fromEntries(Object.entries(ext.reports).map(([session,reports]) => [session,Object.fromEntries(Object.entries(reports).filter(([,report]) => !stale.some(doc => doc.document.id === report.documentId)))]))}))
  for (const doc of stale) {
   const model = monaco.editor.getModel(monaco.Uri.parse(editorModelUri(doc.document)))
   if (model) for (const c of useIDEExtensionsStore.getState().items) monaco.editor.setModelMarkers(model,`plugin:${c.pluginId}:${c.id}`,[])
  }
 })
 monaco.languages.registerCodeActionProvider('*',{
  provideCodeActions(model) {
   const document = documentForModel(model)
   if (!document || document.document.readOnly || document.document.external) return {actions:[],dispose:()=>{}}
   const language = extensionLanguageForPath(document.document.relativePath)?.id ?? model.getLanguageId()
   return {actions:useIDEExtensionsStore.getState().items.filter(c => c.kind === 'codeAction' && applies(c,language)).map(c => ({title:`${c.pluginName}: ${c.title}`,kind:'refactor',command:{id:'goStudio.extension',title:c.title,arguments:[c,document.document.id]}})),dispose:()=>{}}
  },
 },{providedCodeActionKinds:['refactor']})
 monaco.editor.registerCommand('goStudio.extension',(_accessor,item: IDEContribution,documentId: string) => { void runIDEContribution(item,documentId) })
}

export function installIDEExtensionActions(editor: monaco.editor.IStandaloneCodeEditor): void {
 let actions: monaco.IDisposable[] = []
 const install = () => {
  actions.forEach(action => action.dispose())
  actions = useIDEExtensionsStore.getState().items.filter(c => c.kind === 'command' || c.kind === 'codeAction').map(c => editor.addAction({id:`plugin.${c.pluginId}.${c.kind}.${c.id}`,label:`${c.pluginName}: ${c.title}`,contextMenuGroupId:'8_extensions',run:() => runIDEContribution(c,editor.getModel() ? documentForModel(editor.getModel()!)?.document.id : undefined)}))
 }
 install(); const off = useIDEExtensionsStore.subscribe(install)
 editor.onDidDispose(() => {off(); actions.forEach(action => action.dispose())})
}
